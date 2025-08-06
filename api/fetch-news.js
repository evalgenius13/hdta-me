export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    // Focus on national news that affects everyone
    const query = '"federal government" OR "congress" OR "senate" OR "supreme court" OR "white house" OR "national policy" OR "federal law" OR "healthcare policy" OR "national economy" OR "federal reserve"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=15&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      const articles = data.articles.filter(article => 
        article.title && 
        article.description &&
        !article.title.includes('[Removed]') &&
        // Simple filtering - remove obvious junk
        !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper/i.test(article.title))
      );

      res.status(200).json({ articles });
    } else {
      res.status(400).json({ error: data.message || 'No articles found' });
    }
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
}
