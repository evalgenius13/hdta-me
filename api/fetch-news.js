export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    // Target federal and state government policy actions
    const query = '"bill signed" OR "law passed" OR "governor signs" OR "state legislature" OR "supreme court" OR "federal court" OR "executive order" OR "congress passes" OR "senate approves" OR "regulation" OR "rule change"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      const articles = data.articles.filter(article => 
        article.title && 
        article.description &&
        !article.title.includes('[Removed]') &&
        // Remove sports/entertainment/market noise
        !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
        // Keep only if it mentions actual policy actions
        (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
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
