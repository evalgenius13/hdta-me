// api/fetch-news.js - READ-ONLY from database (never calls GNews API)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  console.log('🔍 Fetch-news called (READ-ONLY mode):', new Date().toISOString());

  const today = new Date().toISOString().split('T')[0];

  try {
    // Check if Supabase is configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️ Supabase not configured');
      return returnNoArticlesMessage(res, 'Database not configured');
    }

    // STEP 1: Try to get today's edition from database
    let { data: edition, error: edErr } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    console.log('📊 Today\'s edition query:', { found: !!edition, error: edErr?.message });

    // STEP 2: If no edition for today, try latest edition
    if (edErr || !edition) {
      console.log('📅 No edition for today, checking for latest edition...');
      
      const { data: latestEdition, error: latestErr } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      console.log('📊 Latest edition query:', { found: !!latestEdition, error: latestErr?.message });

      if (latestErr || !latestEdition) {
        console.log('❌ No editions found in database at all');
        return returnNoArticlesMessage(res, 'No articles available - run daily workflow or manual trigger');
      }

      edition = latestEdition;
      console.log(`✅ Using latest edition: ${edition.edition_date} (Issue #${edition.issue_number})`);
    }

    // STEP 3: Get articles for this edition from database
    const { data: rows, error: artErr } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    console.log('📊 Articles query:', { count: rows?.length || 0, error: artErr?.message });

    if (artErr) {
      console.error('❌ Database error fetching articles:', artErr);
      return returnNoArticlesMessage(res, 'Database error loading articles');
    }

    if (!rows || rows.length === 0) {
      console.log('❌ Edition exists but has no articles');
      return returnNoArticlesMessage(res, 'Edition exists but contains no articles');
    }

    // STEP 4: Format articles for frontend
    // Return articles with status 'published' for main site display
    const publishedArticles = rows
      .filter(a => a.article_status === 'published')
      .map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        urlToImage: a.image_url,
        source: { name: a.source_name || 'Unknown Source' },
        publishedAt: a.published_at,
        preGeneratedAnalysis: a.analysis_text,
        isAnalyzed: !!a.analysis_text
      }));

    console.log(`✅ Returning ${publishedArticles.length} published articles from database`);
    console.log(`📊 Total articles in edition: ${rows.length}, Published: ${publishedArticles.length}`);

    return res.json({
      articles: publishedArticles,
      count: publishedArticles.length,
      edition_info: {
        date: edition.edition_date,
        issue_number: edition.issue_number,
        is_automated: true,
        is_today: edition.edition_date === today,
        total_articles: rows.length,
        published_articles: publishedArticles.length
      }
    });

  } catch (error) {
    console.error('❌ Unexpected error in fetch-news:', error);
    return returnNoArticlesMessage(res, 'Unexpected server error');
  }
}

// Helper function to return consistent "no articles" response
function returnNoArticlesMessage(res, reason) {
  const today = new Date().toISOString().split('T')[0];
  
  console.log(`📭 Returning no articles: ${reason}`);
  
  return res.json({
    articles: [],
    count: 0,
    edition_info: {
      date: today,
      issue_number: 'No Data',
      is_automated: false,
      is_today: true,
      message: reason
    },
    error: reason,
    instructions: {
      message: 'No articles available. Articles are fetched once daily or via manual trigger.',
      actions: [
        'Wait for daily cron job (runs at 10 AM)',
        'Use admin panel to manually trigger article fetching',
        'Check Vercel cron job logs for any failures'
      ]
    }
  });
}
