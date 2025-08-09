import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // CDN caching for feed responses
  // Adjust during testing with ?v=timestamp on the URL
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const today = new Date().toISOString().split('T')[0];

    // Allow optional query flags
    // stripPregen defaults true to force fresh personalization on the client
    // pass ?stripPregen=0 to include preGeneratedAnalysis for debugging
    const stripPregen = req.query?.stripPregen !== '0';

    // Try today first
    let { data: edition, error: editionError } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    // Fallback to most recent published or sent
    if (editionError || !edition) {
      const { data: recentEdition, error: recentError } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      if (recentError || !recentEdition) {
        return await legacyNewsFetch(req, res);
      }

      edition = recentEdition;
    }

    // Get analyzed articles for the edition
    const { data: articles, error: articlesError } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (articlesError) throw articlesError;

    // Map to frontend shape
    let formattedArticles = articles.map(a => {
      const base = {
        title: a.title,
        description: a.description,
        url: a.url,
        urlToImage: a.image_url,
        source: { name: a.source_name },
        publishedAt: a.published_at
      };

      if (stripPregen) {
        // Force the client to generate fresh analysis via /api/personalize
        return {
          ...base,
          preGeneratedAnalysis: null,
          isAnalyzed: false
        };
      } else {
        // Debug path to keep pre-generated analysis
        return {
          ...base,
          preGeneratedAnalysis: a.analysis_text || null,
          isAnalyzed: Boolean(a.analysis_text)
        };
      }
    });

    return res.json({
      articles: formattedArticles,
      cached: false,
      count: formattedArticles.length,
      edition_info: {
        date: edition.edition_date,
        issue_number: edition.issue_number,
        is_automated: true,
        is_today: edition.edition_date === today
      }
    });

  } catch (error) {
    console.error('Error fetching automated content:', error);
    return await legacyNewsFetch(req, res);
  }
}

// Legacy fallback using original logic
async function legacyNewsFetch(req, res) {
  try {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({ error: 'News service not configured' });
    }

    const query =
      'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
      query
    )}&lang=en&country=us&max=20&token=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.articles) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({ error: data.error || 'Failed to fetch news' });
    }

    // Filter policy relevant
    let articles = data.articles.filter(article =>
      article.title &&
      article.description &&
      !article.title.includes('[Removed]') &&
      !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
      (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test((article.title || '') + ' ' + (article.description || '')))
    );

    // De-duplicate by similarity
    const seenTitles = new Set();
    articles = articles.filter(article => {
      const normalizedTitle = (article.title || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      for (const seenTitle of seenTitles) {
        const similarity = calculateSimilarity(normalizedTitle, seenTitle);
        if (similarity > 0.8) return false;
      }
      seenTitles.add(normalizedTitle);
      return true;
    });

    const formattedArticles = articles.slice(0, 8).map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image,
      source: { name: a.source?.name || 'News Source' },
      publishedAt: a.publishedAt || a.published_at || new Date().toISOString(),
      preGeneratedAnalysis: null,
      isAnalyzed: false
    }));

    // Cache policy for legacy path
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=900');

    return res.json({
      articles: formattedArticles,
      cached: false,
      count: formattedArticles.length,
      edition_info: {
        date: new Date().toISOString().split('T')[0],
        issue_number: 'Legacy',
        is_automated: false,
        is_today: true
      }
    });

  } catch (error) {
    console.error('Legacy fetch failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'Failed to fetch news from all sources' });
  }
}

// Simple Jaccard similarity for de-dup
function calculateSimilarity(str1, str2) {
  const words1 = new Set((str1 || '').split(' ').filter(w => w.length > 2));
  const words2 = new Set((str2 || '').split(' ').filter(w => w.length > 2));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
