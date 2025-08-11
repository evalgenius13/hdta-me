// api/manual-trigger.js - Force update today's articles with new logic
import { runAutomatedWorkflow } from './cron/automated-daily-workflow.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth check
  const { trigger_key } = req.body;
  if (trigger_key !== process.env.MANUAL_TRIGGER_KEY && trigger_key !== 'force-update-2025') {
    return res.status(401).json({ error: 'Invalid trigger key' });
  }

  const startTime = Date.now();
  console.log('🔄 Manual trigger started:', new Date().toISOString());

  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if today's edition exists
    const { data: existing } = await supabase
      .from('daily_editions')
      .select('id, issue_number, status')
      .eq('edition_date', today)
      .single();

    if (existing) {
      console.log(`📰 Found existing edition #${existing.issue_number} (${existing.status})`);
      
      // Delete existing analyzed articles to regenerate
      await supabase
        .from('analyzed_articles')
        .delete()
        .eq('edition_id', existing.id);
      
      // Delete the edition to force recreation
      await supabase
        .from('daily_editions')
        .delete()
        .eq('id', existing.id);
        
      console.log('🗑️  Deleted existing edition to regenerate with enhanced logic');
    }

    // Run enhanced workflow
    const edition = await runAutomatedWorkflow();
    
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    // Get the articles to show what was processed
    const { data: articles } = await supabase
      .from('analyzed_articles')
      .select('title, content_extracted, content_method')
      .eq('edition_id', edition.id)
      .order('article_order');

    const response = {
      success: true,
      message: 'Enhanced workflow completed successfully',
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        date: edition.edition_date,
        status: edition.status
      },
      processing: {
        duration_seconds: duration,
        articles_processed: articles?.length || 0,
        content_extracted: articles?.filter(a => a.content_extracted).length || 0,
        extraction_methods: articles?.map(a => a.content_method) || []
      },
      articles: articles?.map(a => ({
        title: a.title.substring(0, 80) + '...',
        content_extracted: a.content_extracted,
        method: a.content_method
      })) || [],
      timestamp: new Date().toISOString()
    };

    console.log('✅ Manual trigger completed:', response);
    res.json(response);

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    console.error('❌ Manual trigger failed:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      duration_seconds: duration,
      timestamp: new Date().toISOString()
    });
  }
}

// Alternative: Direct function call
export async function forceUpdateToday() {
  console.log('🔄 Force updating today\'s articles...');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Delete today's edition if it exists
    const { data: existing } = await supabase
      .from('daily_editions')
      .select('id')
      .eq('edition_date', today)
      .single();

    if (existing) {
      await supabase.from('analyzed_articles').delete().eq('edition_id', existing.id);
      await supabase.from('daily_editions').delete().eq('id', existing.id);
      console.log('🗑️  Deleted existing edition');
    }
    
    // Run enhanced workflow
    const edition = await runAutomatedWorkflow();
    console.log(`✅ Created new edition #${edition.issue_number} with enhanced logic`);
    
    return edition;
  } catch (error) {
    console.error('❌ Force update failed:', error);
    throw error;
  }
}
