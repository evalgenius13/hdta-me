export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    // Simple, focused query for policy and economic news
    const query = 'congress OR policy OR economy OR housing OR healthcare OR "student loans"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=12&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      // Basic filtering only
      const articles = data.articles.filter(article => 
        article.title && 
        article.description &&
        !article.title.includes('[Removed]')
      );

      res.status(200).json({ articles });
    } else {
      res.status(400).json({ error: data.message || 'No articles found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
}
