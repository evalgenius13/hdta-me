import { runAutomatedWeeklyWorkflow } from './automated-weekly-workflow.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- AUTHORIZATION ---
  const authHeader = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  try {
    // Run the weekly workflow
    const edition = await runAutomatedWeeklyWorkflow();

    // Get articles for response
    const { data: articles } = await supabase
      .from('analyzed_articles')
      .select('title, analysis_text, article_status, article_score')
      .eq('edition_id', edition.id)
      .order('article_order');

    const articlesWithAnalysis = articles?.filter(a =>
      a.analysis_text &&
      !a.analysis_text.includes('depends on implementation')
    ) || [];

    const duration = Math.floor((Date.now() - startTime) / 1000);

    const response = {
      success: true,
      message: 'Weekly workflow completed successfully',
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        week_start_date: edition.week_start_date,
        week_end_date: edition.week_end_date,
        status: edition.status
      },
      processing: {
        duration_seconds: duration,
        articles_processed: articles?.length || 0,
        articles_analyzed: articlesWithAnalysis.length,
        success_rate: articles?.length > 0 ? Math.round((articlesWithAnalysis.length / articles.length) * 100) : 0
      },
      articles_preview: articles?.slice(0, 5).map(a => ({
        title: a.title.substring(0, 60) + '...',
        has_analysis: !!(a.analysis_text && !a.analysis_text.includes('depends on implementation')),
        status: a.article_status || 'unknown'
      })) || [],
      timestamp: new Date().toISOString()
    };

    return res.json(response);

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      processing: {
        duration_seconds: duration,
        failed_at: 'weekly_workflow_execution'
      },
      timestamp: new Date().toISOString()
    });
  }
}
