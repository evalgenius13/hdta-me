// api/manual-trigger.js - FIXED for weekly operations
import { runAutomatedWeeklyWorkflow } from './cron/automated-weekly-workflow.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ✅ FIXED: Standardized UTC-based week calculation
function getWeekStart() {
  const now = new Date();
  
  // Use UTC to avoid timezone issues
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  
  const dayOfWeek = utc.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7; // Convert Sunday=0 to Monday=0 system
  
  // Calculate Monday of this week
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - daysFromMonday);
  
  return monday.toISOString().split('T')[0];
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
  const thisWeek = getWeekStart();
  
  console.log('🔄 Manual weekly trigger started:', new Date().toISOString());
  console.log('📊 Options:', { force_refetch: !!force_refetch, week_start: thisWeek });

  try {
    // Check environment variables
    const envCheck = {
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      hasNewsAPI: !!process.env.NEWS_API_KEY,
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

    if (!envCheck.hasNewsAPI && !envCheck.hasGNews) {
      return res.status(500).json({
        success: false,
        error: 'News API not configured - missing NEWS_API_KEY or GNEWS_API_KEY'
      });
    }

    // Check if this week's edition already exists
    const { data: existingEdition, error: fetchError } = await supabase
      .from('weekly_editions')
      .select(`
        id, 
        issue_number, 
        status, 
        week_start_date,
        week_end_date
      `)
      .eq('week_start_date', thisWeek)
      .single();

    // Handle the case where no edition exists (not an error)
    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('❌ Database error checking existing edition:', fetchError);
      throw fetchError;
    }

    // Get articles count for existing edition
    let existingArticlesCount = 0;
    if (existingEdition) {
      const { data: articles, error: articlesError } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', existingEdition.id);
      
      if (!articlesError) {
        existingArticlesCount = articles?.length || 0;
      }
    }

    let edition;
    let action = 'created';

    // FIXED LOGIC: Handle all cases properly for weekly
    if (existingEdition && force_refetch) {
      // Force refetch requested - delete and recreate regardless of article count
      console.log('🔄 Force refetch requested - deleting existing weekly edition');
      await supabase.from('analyzed_articles').delete().eq('edition_id', existingEdition.id);
      await supabase.from('weekly_editions').delete().eq('id', existingEdition.id);
      
      edition = await runAutomatedWeeklyWorkflow();
      action = 'refetched';
      
    } else if (existingEdition && existingArticlesCount > 0) {
      // Edition exists and has articles - preserve it
      console.log(`📰 Found existing weekly edition #${existingEdition.issue_number} with ${existingArticlesCount} articles`);
      console.log('✅ Using existing weekly articles');
      
      edition = existingEdition;
      action = 'preserved';
      
    } else if (existingEdition && existingArticlesCount === 0) {
      // Edition exists but has no articles - delete it first, then create new one
      console.log('📝 Found existing weekly edition with no articles - will recreate');
      await supabase.from('weekly_editions').delete().eq('id', existingEdition.id);
      
      edition = await runAutomatedWeeklyWorkflow();
      action = 'recreated';
      
    } else {
      // No existing edition - create new one
      console.log('📝 Creating new weekly edition with fresh articles');
      edition = await runAutomatedWeeklyWorkflow();
      action = 'created';
    }
    
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    // Get current articles for response (separate query)
    const { data: currentArticles } = await supabase
      .from('analyzed_articles')
      .select('title, analysis_text, article_status, article_score, article_order')
      .eq('edition_id', edition.id)
      .order('article_order');

    const publishedCount = currentArticles?.filter(a => a.article_status === 'published').length || 0;
    const queuedCount = currentArticles?.filter(a => a.article_status === 'queue').length || 0;

    // Get week end date
    const weekEnd = edition.week_end_date || 
      new Date(new Date(edition.week_start_date).getTime() + 6 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

    return res.json({
      success: true,
      message: `Weekly edition ${action} successfully`,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        week_start_date: edition.week_start_date,
        week_end_date: weekEnd,
        status: edition.status
      },
      processing: {
        duration_seconds: duration,
        articles_total: currentArticles?.length || 0,
        articles_published: publishedCount,
        articles_queued: queuedCount,
        action: action
      },
      articles_preview: currentArticles?.slice(0, 5).map(a => ({
        title: a.title.substring(0, 60) + '...',
        status: a.article_status || 'unknown',
        order: a.article_order
      })) || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    console.error('❌ Manual weekly trigger failed:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      processing: {
        duration_seconds: duration,
        failed_at: 'weekly_workflow_execution'
      },
      timestamp: new Date().toISOString()
    });
  }
}
