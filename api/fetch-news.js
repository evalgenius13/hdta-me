// api/fetch-news.js - FIXED with enhanced CORS and error handling
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Enhanced CORS handling
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
}

export default async function handler(req, res) {
  // Set CORS headers first
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  console.log('🔍 Fetch-news called at:', new Date().toISOString());

  const today = new Date().toISOString().split('T')[0];
  console.log('📅 Looking for edition on:', today);

  try {
    // Check if Supabase is configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️ Supabase not configured, using fallback');
      return await legacyNewsFetch(req, res);
    }

    // Try to get today's edition
    const { data: edition, error: edErr } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .in('status', ['published', 'sent'])
      .single();

    console.log('📊 Edition query result:', { edition: !!edition, error: edErr?.message });

    if (edErr || !edition) {
      console.log('📰 No edition for today, trying latest...');
      
      const { data: latest, error: latestErr } = await supabase
        .from('daily_editions')
        .select('*')
        .in('status', ['published', 'sent'])
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      console.log('📊 Latest edition result:', { latest: !!latest, error: latestErr?.message });

      if (latestErr || !latest) {
        console.log('🔄 Falling back to legacy news fetch');
        return await legacyNewsFetch(req, res);
      }

      edition = latest;
    }

    // Get articles for this edition
    const { data: rows, error: artErr } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    console.log('📊 Articles query result:', { count: rows?.length || 0, error: artErr?.message });

    if (artErr) throw artErr;

    if (!rows || rows.length === 0) {
      console.log('📰 No articles found, using legacy fetch');
      return await legacyNewsFetch(req, res);
    }

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

    console.log('✅ Returning', articles.length, 'articles from database');

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

  } catch (error) {
    console.error('❌ Database fetch failed:', error);
    console.log('🔄 Falling back to legacy news fetch');
    return await legacyNewsFetch(req, res);
  }
}

// Enhanced legacy fetch with better error handling and debugging
async function legacyNewsFetch(req, res) {
  try {
    console.log('📡 Using legacy GNews API...');
    
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      console.log('❌ No GNews API key found');
      return res.json({
        articles: [],
        count: 0,
        edition_info: {
          date: new Date().toISOString().split('T')[0],
          issue_number: 'No API Key',
          is_automated: false,
          is_today: true
        },
        error: 'News service not configured - set GNEWS_API_KEY environment variable'
      });
    }

    // Enhanced query for better policy/government news
    const query = 'congress OR senate OR "executive order" OR "supreme court" OR regulation OR "bill signed" OR governor OR federal';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=15&token=${API_KEY}`;

    console.log('🔍 Fetching from GNews with query:', query);
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ GNews API error:', response.status, errorText);
      throw new Error(`GNews API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('📊 GNews response:', { 
      totalArticles: data.totalArticles, 
      articles: data.articles?.length,
      hasError: !!data.error 
    });

    if (data.error) {
      throw new Error(`GNews API error: ${data.error}`);
    }

    if (!data.articles || data.articles.length === 0) {
      console.log('📰 No articles from GNews');
      return res.json({
        articles: [],
        count: 0,
        edition_info: {
          date: new Date().toISOString().split('T')[0],
          issue_number: 'No Articles',
          is_automated: false,
          is_today: true
        },
        message: 'No policy news articles available at this time'
      });
    }

    // Filter for policy-relevant content
    let filteredArticles = data.articles.filter(article => {
      if (!article?.title || !article?.description) return false;
      
      const content = (article.title + ' ' + article.description).toLowerCase();
      
      // Exclude obviously non-policy content
      const excludeKeywords = [
        'nfl', 'nba', 'mlb', 'nhl', 'sports', 'game', 'score',
        'celebrity', 'entertainment', 'movie', 'music', 'actor',
        'stocks', 'earnings', 'market', 'crypto', 'bitcoin'
      ];
      
      const hasExcluded = excludeKeywords.some(keyword => content.includes(keyword));
      if (hasExcluded) return false;
      
      // Include policy-relevant content
      const includeKeywords = [
        'congress', 'senate', 'house', 'bill', 'law', 'court', 
        'federal', 'government', 'policy', 'regulation', 'ruling',
        'executive', 'governor', 'mayor', 'election', 'vote'
      ];
      
      return includeKeywords.some(keyword => content.includes(keyword));
    });

    // Remove near-duplicates
    filteredArticles = removeNearDuplicates(filteredArticles);

    const articles = filteredArticles.slice(0, 8).map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image,
      source: { name: a.source?.name },
      publishedAt: a.publishedAt,
      preGeneratedAnalysis: null,
      isAnalyzed: false
    }));

    console.log('✅ Returning', articles.length, 'filtered articles from GNews');

    return res.json({
      articles,
      count: articles.length,
      edition_info: {
        date: new Date().toISOString().split('T')[0],
        issue_number: 'Live',
        is_automated: false,
        is_today: true
      },
      source: 'gnews_api'
    });

  } catch (error) {
    console.error('❌ Legacy fetch failed:', error);
    
    // Return mock data as last resort for testing
    const mockArticles = [
      {
        title: "Senate Votes on Infrastructure Bill",
        description: "The U.S. Senate is expected to vote on a comprehensive infrastructure package that includes funding for roads, bridges, and broadband expansion.",
        url: "https://example.com/senate-infrastructure",
        urlToImage: null,
        source: { name: "Mock News" },
        publishedAt: new Date().toISOString(),
        preGeneratedAnalysis: null,
        isAnalyzed: false
      },
      {
        title: "Federal Reserve Announces Interest Rate Decision", 
        description: "The Federal Reserve is set to announce its latest interest rate decision, which could impact mortgage rates and consumer borrowing costs.",
        url: "https://example.com/fed-rates",
        urlToImage: null,
        source: { name: "Mock News" },
        publishedAt: new Date().toISOString(),
        preGeneratedAnalysis: null,
        isAnalyzed: false
      }
    ];
    
    return res.json({
      articles: mockArticles,
      count: mockArticles.length,
      edition_info: {
        date: new Date().toISOString().split('T')[0],
        issue_number: 'Mock',
        is_automated: false,
        is_today: true
      },
      error: 'All news sources failed - showing mock data',
      details: error.message,
      source: 'mock_data'
    });
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
