// api/admin.js - FIXED with proper field mapping
import { createClient } from '@supabase/supabase-js';
import { runAutomatedWorkflow } from './cron/automated-daily-workflow.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple auth check
  const authHeader = req.headers.authorization;
  const adminKey = process.env.ADMIN_KEY || 'hdta-admin-2025-temp';
  
  if (!authHeader || authHeader !== `Bearer ${adminKey}`) {
    return res.status(401).json({ 
      error: 'Unauthorized - Invalid admin key',
      hint: 'Set ADMIN_KEY environment variable or use default key'
    });
  }

  const { action } = req.query;

  try {
    switch (action) {
      case 'get-articles':
        return await getArticles(req, res);
      case 'update-analysis':
        return await updateAnalysis(req, res);
      case 'remove-article':
        return await removeArticle(req, res);
      case 'regenerate':
        return await regenerateToday(req, res);
      case 'clear-today':
        return await clearToday(req, res);
      case 'get-stats':
        return await getStats(req, res);
      case 'get-logs':
        return await getLogs(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getArticles(req, res) {
  const today = new Date().toISOString().split('T')[0];
  
  // Get today's edition
  const { data: edition } = await supabase
    .from('daily_editions')
    .select('*')
    .eq('edition_date', today)
    .single();

  if (!edition) {
    return res.json({ 
      articles: [], 
      edition: null,
      message: 'No edition found for today' 
    });
  }

  // Get ALL articles for this edition
  const { data: articles } = await supabase
    .from('analyzed_articles')
    .select('*')
    .eq('edition_id', edition.id)
    .order('article_order', { ascending: true }); // ✅ Order by correct field

  // ✅ FIXED: Proper field mapping from database to frontend
  const formatted = articles?.map(a => ({
    id: a.id,
    title: a.title,
    description: a.description,
    url: a.url,
    urlToImage: a.image_url,  // ✅ Map image_url -> urlToImage
    source: { name: a.source_name },  // ✅ Map source_name -> source.name
    publishedAt: a.published_at,  // ✅ Map published_at -> publishedAt
    preGeneratedAnalysis: a.analysis_text,  // ✅ Map analysis_text -> preGeneratedAnalysis
    analysisWordCount: a.analysis_word_count,
    order: a.article_order,  // ✅ Map article_order -> order
    status: a.article_status || 'queue',  // ✅ Map article_status -> status
    score: a.article_score || 0  // ✅ Map article_score -> score
  })) || [];

  // ✅ FIXED: Categorize by actual status field
  const published = formatted.filter(a => a.status === 'published');
  const drafts = formatted.filter(a => a.status === 'draft');
  const queue = formatted.filter(a => a.status === 'queue');
  const rejected = formatted.filter(a => a.status === 'rejected');

  console.log(`Admin API returning ${formatted.length} articles:`, {
    published: published.length,
    drafts: drafts.length,
    queue: queue.length,
    rejected: rejected.length
  });

  return res.json({
    articles: formatted,
    edition: {
      id: edition.id,
      date: edition.edition_date,
      issue_number: edition.issue_number,
      status: edition.status,
      featured_headline: edition.featured_headline
    },
    summary: {
      total: formatted.length,
      published: published.length,
      drafts: drafts.length,
      queue: queue.length,
      rejected: rejected.length
    }
  });
}

async function updateAnalysis(req, res) {
  const { articleId, newAnalysis } = req.body;
  
  if (!articleId || !newAnalysis) {
    return res.status(400).json({ error: 'Missing articleId or newAnalysis' });
  }

  const wordCount = newAnalysis.split(/\s+/).filter(Boolean).length;
  
  // ✅ FIXED: Update correct database field
  const { error } = await supabase
    .from('analyzed_articles')
    .update({
      analysis_text: newAnalysis,  // ✅ Correct field name
      analysis_word_count: wordCount,
      updated_at: new Date().toISOString()
    })
    .eq('id', articleId);

  if (error) throw error;

  return res.json({ 
    success: true, 
    message: 'Analysis updated successfully',
    wordCount 
  });
}

async function removeArticle(req, res) {
  const { articleId } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'Missing articleId' });
  }

  const { error } = await supabase
    .from('analyzed_articles')
    .delete()
    .eq('id', articleId);

  if (error) throw error;

  return res.json({ 
    success: true, 
    message: 'Article removed successfully' 
  });
}

async function regenerateToday(req, res) {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  console.log('🔄 Admin regenerate started');

  // Delete existing edition to force recreation
  const { data: existing } = await supabase
    .from('daily_editions')
    .select('id')
    .eq('edition_date', today)
    .single();

  if (existing) {
    await supabase.from('analyzed_articles').delete().eq('edition_id', existing.id);
    await supabase.from('daily_editions').delete().eq('id', existing.id);
    console.log('🗑️ Deleted existing edition');
  }

  // Run workflow
  const edition = await runAutomatedWorkflow();
  const duration = Math.floor((Date.now() - startTime) / 1000);

  // Get article count
  const { data: articles } = await supabase
    .from('analyzed_articles')
    .select('id, analysis_text')
    .eq('edition_id', edition.id);

  const analyzedCount = articles?.filter(a => a.analysis_text && 
    !a.analysis_text.includes('depends on implementation')).length || 0;

  return res.json({
    success: true,
    edition: {
      id: edition.id,
      issue_number: edition.issue_number,
      date: edition.edition_date,
      status: edition.status
    },
    processing: {
      duration_seconds: duration,
      articles_processed: articles?.length || 0,
      articles_analyzed: analyzedCount,
      success_rate: articles?.length > 0 ? Math.round((analyzedCount / articles.length) * 100) : 0
    },
    timestamp: new Date().toISOString()
  });
}

async function clearToday(req, res) {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: edition } = await supabase
    .from('daily_editions')
    .select('id')
    .eq('edition_date', today)
    .single();

  if (edition) {
    await supabase.from('analyzed_articles').delete().eq('edition_id', edition.id);
    await supabase.from('daily_editions').delete().eq('id', edition.id);
  }

  return res.json({ 
    success: true, 
    message: 'Today\'s edition cleared successfully' 
  });
}

async function getStats(req, res) {
  const today = new Date().toISOString().split('T')[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  
  // Get recent editions
  const { data: editions } = await supabase
    .from('daily_editions')
    .select(`
      *,
      analyzed_articles (
        id,
        analysis_text,
        analysis_word_count,
        source_name
      )
    `)
    .gte('edition_date', lastWeek.toISOString().split('T')[0])
    .order('edition_date', { ascending: false });

  const stats = {
    total_editions: editions?.length || 0,
    total_articles: 0,
    avg_articles_per_edition: 0,
    avg_word_count: 0,
    top_sources: {},
    success_rate: 0,
    recent_activity: []
  };

  if (editions && editions.length > 0) {
    const allArticles = editions.flatMap(e => e.analyzed_articles || []);
    stats.total_articles = allArticles.length;
    stats.avg_articles_per_edition = Math.round(stats.total_articles / editions.length);
    
    const analyzedArticles = allArticles.filter(a => 
      a.analysis_text && !a.analysis_text.includes('depends on implementation'));
    
    if (analyzedArticles.length > 0) {
      stats.avg_word_count = Math.round(
        analyzedArticles.reduce((sum, a) => sum + (a.analysis_word_count || 0), 0) / analyzedArticles.length
      );
      stats.success_rate = Math.round((analyzedArticles.length / allArticles.length) * 100);
    }

    // Top sources
    allArticles.forEach(a => {
      if (a.source_name) {
        stats.top_sources[a.source_name] = (stats.top_sources[a.source_name] || 0) + 1;
      }
    });

    // Recent activity
    stats.recent_activity = editions.slice(0, 5).map(e => ({
      date: e.edition_date,
      issue_number: e.issue_number,
      status: e.status,
      article_count: e.analyzed_articles?.length || 0,
      analyzed_count: e.analyzed_articles?.filter(a => 
        a.analysis_text && !a.analysis_text.includes('depends on implementation')).length || 0
    }));
  }

  return res.json(stats);
}

async function getLogs(req, res) {
  // In a real implementation, you'd read from log files or a logging service
  const logs = [
    { timestamp: new Date().toISOString(), level: 'info', message: 'Admin panel accessed' },
    { timestamp: new Date(Date.now() - 300000).toISOString(), level: 'success', message: 'Daily workflow completed' },
    { timestamp: new Date(Date.now() - 600000).toISOString(), level: 'warning', message: 'Low article count detected' },
    { timestamp: new Date(Date.now() - 900000).toISOString(), level: 'info', message: 'Fetching articles from GNews' }
  ];

  return res.json({ logs });
}
