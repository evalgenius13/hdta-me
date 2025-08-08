import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    
    // First try to get today's published edition
    let { data: edition, error: editionError } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .eq('status', 'published')
      .single();

    // If no edition for today, get the most recent published edition
    if (editionError || !edition) {
      const { data: recentEdition, error: recentError } = await supabase
        .from('daily_editions')
        .select('*')
        .eq('status', 'published')
        .order('edition_date', { ascending: false })
        .limit(1)
        .single();

      if (recentError || !recentEdition) {
        console.log('No automated content found, falling back to legacy news fetch...');
        return await legacyNewsFetch(req, res);
      }

      edition = recentEdition;
    }

    // Get articles for this edition
    const { data: articles, error: articlesError } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (articlesError) {
      throw articlesError;
    }

    // Format response to match your existing frontend expectations
    const formattedArticles = articles.map(article => ({
      title: article.title,
      description: article.description,
      url: article.url,
      urlToImage: article.image_url,
      source: {
        name: article.source_name
      },
      publishedAt: article.published_at,
      // Add pre-generated analysis as a special field
      preGeneratedAnalysis: article.analysis_text,
      isAnalyzed: true
    }));

    // Cache the response for 1 hour
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    
    res.json({
      articles: formattedArticles,
      cached: false, // Maintain compatibility with existing frontend
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
    
    // Fallback to legacy news fetch if automated system fails
    console.log('Automated system failed, falling back to legacy news fetch...');
    return await legacyNewsFetch(req, res);
  }
}

// Legacy fallback function using your original logic
async function legacyNewsFetch(req, res) {
  try {
    console.log('Using legacy news fetch as fallback...');
    
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'News service not configured' });
    }
    
    const query = 'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.articles) {
      return res.status(400).json({ error: data.error || 'Failed to fetch news' });
    }
    
    // Apply your existing filtering logic
    let articles = data.articles.filter(article => 
      article.title && 
      article.description && 
      !article.title.includes('[Removed]') &&
      !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
      (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
    );
    
    // Remove duplicates (your existing logic)
    const seenTitles = new Set();
    articles = articles.filter(article => {
      const normalizedTitle = article.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      for (const seenTitle of seenTitles) {
        const similarity = calculateSimilarity(normalizedTitle, seenTitle);
        if (similarity > 0.8) {
          return false; // Skip duplicate
        }
      }
      
      seenTitles.add(normalizedTitle);
      return true;
    });
    
    // Format articles without pre-generated analysis
    const formattedArticles = articles.slice(0, 8).map(article => ({
      ...article,
      preGeneratedAnalysis: null,
      isAnalyzed: false
    }));
    
    res.json({ 
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
    console.error('Legacy fetch also failed:', error);
    res.status(500).json({ error: 'Failed to fetch news from all sources' });
  }
}

// Helper function for duplicate detection
function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(str2.split(' ').filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}
