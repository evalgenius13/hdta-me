// api/fetch-news.js - READ-ONLY from database (never calls external news APIs)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS + cache
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  // edge/static caching: 5m fresh, 10m stale
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
}

// Consistent empty payload helper
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  console.log('🔍 fetch-news (READ-ONLY) invoked:', new Date().toISOString());

  // Simple, safe limit (default 6)
  const limitParam = Number.parseInt(req.query?.limit, 10);
  const MAX_LIMIT = 20;
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : 6;

  // Note: the cron job stores edition_date as YYYY-MM-DD in UTC via toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0];

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️ Supabase not configured');
      return returnNoArticlesMessage(res, 'Database not configured');
    }

    // 1) Try today's edition (published/sent)
    let { data: edition, error: edErr } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    console.log('📊 Today edition lookup:', { found: !!edition, error: edErr?.message });

    // 2) Fallback to latest published/sent edition
    if (edErr || !edition) {
      console.log('📅 No today edition; fetching latest published/sent…');

      const { data: latestEdition, error: latestErr } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .order('issue_number', { ascending: false }) // tie-breaker if multiple same dates
        .limit(1)
        .single();

      console.log('📊 Latest edition lookup:', { found: !!latestEdition, error: latestErr?.message });

      if (latestErr || !latestEdition) {
        return returnNoArticlesMessage(res, 'No editions found. Run daily workflow or manual trigger.');
      }

      edition = latestEdition;
      console.log(`✅ Using latest edition: ${edition.edition_date} (#${edition.issue_number})`);
    }

    // 3) Fetch all articles for edition, ordered
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

    // 4) Format for frontend:
    //    - Only "published" articles
    //    - Preserve preGeneratedAnalysis (back-compat)
    //    - Also emit whatsHappening & affectsMe (camelCase) if present in DB
    const published = rows.filter(a => a.article_status === 'published');

    // Respect limit while preserving original ordering
    const sliced = published.slice(0, limit);

    const articles = sliced.map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image_url || null,
      source: { name: a.source_name || 'Unknown Source' },
      publishedAt: a.published_at,
      // Backward-compatible content:
      preGeneratedAnalysis: a.analysis_text,
      isAnalyzed: !!a.analysis_text,
      // New structured fields (frontend will use when available):
      whatsHappening: a.whats_happening ?? null,
      affectsMe: a.affects_me ?? null
    }));

    console.log(`✅ Returning ${articles.length} published articles (requested limit=${limit})`);
    console.log(`📊 Edition totals -> all: ${rows.length}, published: ${published.length}`);

    return res.json({
      articles,
      count: articles.length,
      edition_info: {
        date: edition.edition_date,
        issue_number: edition.issue_number,
        is_automated: true,
        is_today: edition.edition_date === today,
        total_articles: rows.length,
        published_articles: published.length
      }
    });
  } catch (error) {
    console.error('❌ Unexpected fetch-news error:', error);
    return returnNoArticlesMessage(res, 'Unexpected server error');
  }
}
