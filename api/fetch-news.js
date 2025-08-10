// api/fetch-news.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const today = new Date().toISOString().split('T')[0];

  try {
    let { data: edition, error: edErr } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    if (edErr || !edition) {
      const { data: latest, error: latestErr } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      if (latestErr || !latest) {
        return await legacyNewsFetch(req, res);
      }

      edition = latest;
    }

    const { data: rows, error: artErr } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (artErr) throw artErr;

    const articles = rows.map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image_url,
      source: { name: a.source_name },
      publishedAt: a.published_at,
      preGeneratedAnalysis: a.analysis_text,
      isAnalyzed: true
    }));

    return res.json({
      articles,
      count: articles.length,
      edition_info: {
        date: edition.edition_date,
        issue_number: edition.issue_number,
        is_automated: true,
        is_today: edition.edition_date === today
      }
    });
  } catch {
    return await legacyNewsFetch(req, res);
  }
}

async function legacyNewsFetch(req, res) {
  try {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'News service not configured' });

    const query =
      'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
      query
    )}&lang=en&country=us&max=20&token=${API_KEY}`;

    const r = await fetch(url);
    const data = await r.json();
    if (!data.articles) return res.status(400).json({ error: data.error || 'Failed to fetch news' });

    let articles = data.articles.filter(
      a =>
        a.title &&
        a.description &&
        !/\[Removed\]/i.test(a.title) &&
        !/\b(golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment)\b/i.test(a.title) &&
        /\b(bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves|ruling|decision)\b/i.test(
          (a.title || '') + ' ' + (a.description || '')
        )
    );

    articles = removeNearDuplicates(articles);

    const formatted = articles.slice(0, 8).map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image,
      source: { name: a.source?.name },
      publishedAt: a.publishedAt,
      preGeneratedAnalysis: null,
      isAnalyzed: false
    }));

    return res.json({
      articles: formatted,
      count: formatted.length,
      edition_info: {
        date: new Date().toISOString().split('T')[0],
        issue_number: 'Legacy',
        is_automated: false,
        is_today: true
      }
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch news from all sources' });
  }
}

function removeNearDuplicates(list) {
  const seen = [];
  const out = [];
  for (const a of list) {
    const norm = (a.title || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    let dup = false;
    for (const s of seen) {
      const sim = jaccard(norm, s);
      if (sim > 0.8) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      seen.push(norm);
      out.push(a);
    }
  }
  return out;
}

function jaccard(a, b) {
  const wa = new Set(a.split(' ').filter(w => w.length > 2));
  const wb = new Set(b.split(' ').filter(w => w.length > 2));
  const inter = new Set([...wa].filter(w => wb.has(w)));
  const uni = new Set([...wa, ...wb]);
  if (uni.size === 0) return 0;
  return inter.size / uni.size;
}
