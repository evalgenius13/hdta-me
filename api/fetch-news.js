// api/fetch-news.js - Basic version with just Redis news caching
const { getNewsList, storeNewsList } = require('../lib/redis');

module.exports = async function handler(req, res) {
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

    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    const query = 'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      const articles = data.articles.filter(article => 
        article.title && 
        article.description && 
        !article.title.includes('[Removed]') &&
        !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
        (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
      );

      // Cache the filtered articles
      await storeNewsList(articles);
      
      res.status(200).json({ 
        articles,
        cached: false,
        count: articles.length
      });
    } else {
      res.status(400).json({ error: data.error || 'No articles found' });
    }
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
};
