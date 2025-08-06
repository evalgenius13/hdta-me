// api/fetch-news.js - Fixed version with security and consistency
const { getNewsList, storeNewsList } = require('../lib/redis');

// Calculate similarity between two strings
function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(str2.split(' ').filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Check cache first
    const cachedNews = await getNewsList();
    if (cachedNews) {
      console.log('Serving cached news');
      return res.status(200).json({ 
        articles: cachedNews,
        cached: true 
      });
    }

    console.log('Fetching fresh news from GNews API');

    // Secure API key handling - no hardcoded fallback
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      console.error('GNEWS_API_KEY not configured');
      return res.status(500).json({ error: 'News service not configured' });
    }
    
    const query = 'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.articles) {
      console.error('GNews API error:', data);
      return res.status(400).json({ error: data.error || 'Failed to fetch news' });
    }

    // Filter and deduplicate articles
    let articles = data.articles.filter(article => 
      article.title && 
      article.description && 
      !article.title.includes('[Removed]') &&
      !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
      (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
    );

    // Remove duplicates based on title similarity
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

    console.log(`After deduplication: ${articles.length} unique articles`);

    // Cache the filtered articles
    await storeNewsList(articles);
    
    res.status(200).json({ 
      articles,
      cached: false,
      count: articles.length
    });

  } catch (error) {
    console.error('Fetch news error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
}
