// api/fetch-news.js
// READ-ONLY endpoint: returns the latest (or today's) edition from Supabase.
// Never calls upstream news APIs. Safe for the public frontend.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS + cache
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  // 5m CDN cache, allow 10m stale-while-revalidate
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  console.log('🔍 fetch-news (READ-ONLY):', new Date().toISOString());
  const today = new Date().toISOString().split('T')[0];

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️ Supabase not configured');
      return returnNoArticlesMessage(res, 'Database not configured');
    }

    // 1) Try today (published or sent)
    let { data: edition, error: edErr } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    // 2) Fallback to latest published/sent
    if (edErr || !edition) {
      const { data: latest, error: latestErr } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      if (latestErr || !latest) {
        console.log('❌ No editions found in database at all');
        return returnNoArticlesMessage(res, 'No articles available - run daily workflow or manual trigger');
      }
      edition = latest;
      console.log(`✅ Using latest edition: ${edition.edition_date} (Issue #${edition.issue_number})`);
    }

    // 3) Pull all articles for that edition
    const { data: rows, error: artErr } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (artErr) {
      console.error('❌ Database error fetching articles:', artErr);
      return returnNoArticlesMessage(res, 'Database error loading articles');
    }
    if (!rows?.length) {
      console.log('❌ Edition exists but has no articles');
      return returnNoArticlesMessage(res, 'Edition exists but contains no articles');
    }

    // 4) For the public site, return only "published" articles (cap to 6)
    const published = rows
      .filter((a) => a.article_status === 'published')
      .slice(0, 6)
      .map((a) => ({
        title: a.title,
        description: a.description,
        url: a.url,
        urlToImage: a.image_url,
        source: { name: a.source_name || 'Unknown Source' },
        publishedAt: a.published_at,
        // legacy analysis for older rows:
        preGeneratedAnalysis: a.analysis_text || null,
        // if your table has these nullable fields, the frontend will render sections:
        whatsHappening: a.whats_happening || null,
        affectsMe: a.affects_me || null,
        isAnalyzed: !!(a.analysis_text || a.whats_happening || a.affects_me),
      }));

    console.log(`✅ Returning ${published.length} published articles (of ${rows.length} total in edition)`);

    return res.json({
      articles: published,
      count: published.length,
      edition_info: {
        date: edition.edition_date,
        issue_number: edition.issue_number,
        is_automated: true,
        is_today: edition.edition_date === today,
        total_articles: rows.length,
        published_articles: published.length,
      },
    });
  } catch (e) {
    console.error('❌ Unexpected error in fetch-news:', e);
    return returnNoArticlesMessage(res, 'Unexpected server error');
  }
}

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
      message: reason,
    },
    error: reason,
    instructions: {
      message: 'No articles available. Articles are fetched once daily or via manual trigger.',
      actions: [
        'Wait for daily cron job (runs on schedule)',
        'Use admin panel to manually trigger article fetching',
        'Check Vercel cron logs for any failures',
      ],
    },
  });
}
