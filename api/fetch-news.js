export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const NEWS_API_KEY = process.env.NEWS_API_KEY || '84087b3e66df4bbaab9416aeeff59fdc';
    const url = `https://newsapi.org/v2/top-headlines?country=us&category=business&pageSize=10&apiKey=${NEWS_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'ok') {
      res.status(200).json({ articles: data.articles });
    } else {
      res.status(400).json({ error: data.message });
    }
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
}
