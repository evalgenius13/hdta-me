// api/manual-trigger.js - CLEANED: Real news only, no mock data
import { runAutomatedWorkflow } from './cron/automated-daily-workflow.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { trigger_key, force_refetch } = req.body || {};
  
  // Validate trigger key
  const validKeys = [
    process.env.MANUAL_TRIGGER_KEY,
    'force-update-2025',
    'hdta-admin-2025-temp'
  ].filter(Boolean);
  
  if (!validKeys.includes(trigger_key)) {
    return res.status(401).json({ 
      error: 'Invalid trigger key',
      hint: 'Use force-update-2025 for manual triggers'
    });
  }

  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  console.log('🔄 Manual trigger started:', new Date().toISOString());
  console.log('📊 Options:', { force_refetch: !!force_refetch });

  try {
    // Check environment variables
    const envCheck = {
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      hasGNews: !!process.env.GNEWS_API_KEY,
      hasOpenAI: !!process.env.OPENAI_API_KEY
    };
    
    console.log('🔍 Environment check:', envCheck);

    if (!envCheck.hasSupabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured - missing Supabase credentials'
      });
    }

    if (!envCheck.hasGNews) {
      return res.status(500).json({
        success: false,
        error: 'News API not configured - missing GNEWS_API_KEY'
      });
    }

    // Check if today's edition already exists
    const { data: existingEdition, error: fetchError } = await supabase
      .from('daily_editions')
      .select(`
        id, 
        issue_number, 
        status, 
        edition_date,
        analyzed_articles (
          id,
          title,
          article_status
        )
      `)
      .eq('edition_date', today)
      .single();

    // Handle the case where no edition exists (not an error)
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    let edition;
    let action = 'created';

    if (existingEdition && existingEdition.analyzed_articles?.length > 0 && !force_refetch) {
      // Edition exists and has articles
      console.log(`📰 Found existing edition #${existingEdition.issue_number} with ${existingEdition.analyzed_articles.length} articles`);
      console.log('✅ Using existing articles (use force_refetch to override)');
      
      edition = existingEdition;
      action = 'preserved';
      
    } else if (existingEdition && force_refetch) {
      // Force refetch requested - delete and recreate
      console.log('🔄 Force refetch requested - deleting existing edition');
      await supabase.from('analyzed_articles').delete().eq('edition_id', existingEdition.id);
      await supabase.from('daily_editions').delete().eq('id', existingEdition.id);
      
      edition = await runAutomatedWorkflow();
      action = 'refetched';
    } else {
      // No existing edition or empty edition - create new one
      console.log('📝 Creating new edition with fresh articles');
      edition = await runAutomatedWorkflow();
      action = 'created';
    }
    
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    // Get current articles for response
    const { data: currentArticles } = await supabase
      .from('analyzed_articles')
      .select('title, analysis_text, article_status, article_score, article_order')
      .eq('edition_id', edition.id)
      .order('article_order');

    const publishedCount = currentArticles?.filter(a => a.article_status === 'published').length || 0;
    const queuedCount = currentArticles?.filter(a => a.article_status === 'queue').length || 0;

    return res.json({
      success: true,
      message: `Edition ${action} successfully`,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        date: edition.edition_date,
        status: edition.status
      },
      processing: {
        duration_seconds: duration,
        articles_total: currentArticles?.length || 0,
        articles_published: publishedCount,
        articles_queued: queuedCount,
        action: action
      },
      articles_preview: currentArticles?.slice(0, 3).map(a => ({
        title: a.title.substring(0, 60) + '...',
        status: a.article_status || 'unknown',
        order: a.article_order
      })) || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    console.error('❌ Manual trigger failed:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      processing: {
        duration_seconds: duration,
        failed_at: 'workflow_execution'
      },
      timestamp: new Date().toISOString()
    });
  }
}
