// Simple article cache
let articleCache = {
  articles: [],
  timestamp: 0,
  cacheHours: 6
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const now = Date.now();
    const cacheAge = now - articleCache.timestamp;
    const cacheExpired = cacheAge > (articleCache.cacheHours * 60 * 60 * 1000);
    
    // Return cached articles if still fresh
    if (articleCache.articles.length > 0 && !cacheExpired) {
      console.log('Returning cached articles, age:', Math.round(cacheAge / 1000 / 60), 'minutes');
      return res.status(200).json({ 
        articles: articleCache.articles,
        cached: true,
        age_minutes: Math.round(cacheAge / 1000 / 60)
      });
    }
    
    console.log('Cache expired or empty, fetching fresh articles...');
    
    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    const query = 'congress OR policy OR economy OR housing OR healthcare';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=15&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      const articles = data.articles.filter(article => 
        article.title && 
        article.description &&
        !article.title.includes('[Removed]') &&
        !(/actor|actress|celebrity|movie|tv show|series|emmy|oscar/i.test(article.title) && 
          !/policy|regulation|law|healthcare policy|government/i.test(article.description))
      );

      // Cache the articles
      articleCache = {
        articles: articles,
        timestamp: now,
        cacheHours: 6
      };
      
      console.log('Cached', articles.length, 'fresh articles');
      res.status(200).json({ articles, cached: false });
    } else {
      console.error('GNews error:', data);
      res.status(400).json({ error: data.message || 'No articles found' });
    }
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
}
