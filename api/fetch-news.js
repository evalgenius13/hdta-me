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
    const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
    
    // Debug: Check if API key exists
    if (!GNEWS_API_KEY) {
      return res.status(500).json({ error: 'GNews API key not found in environment variables' });
    }

    // Start with a simple query to test
    const simpleQuery = 'politics';
    const url = `https://gnews.io/api/v4/search?q=${simpleQuery}&lang=en&country=us&max=10&token=${GNEWS_API_KEY}`;
    
    console.log('Making request to GNews...');
    console.log('URL (without token):', url.replace(GNEWS_API_KEY, '[HIDDEN]'));
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('GNews response status:', response.status);
    console.log('GNews response data:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.articles) {
      return res.status(200).json({ 
        articles: data.articles,
        source: 'gnews',
        total: data.totalArticles || data.articles.length,
        debug: {
          status: response.status,
          query: simpleQuery
        }
      });
    } else {
      return res.status(400).json({ 
        error: 'GNews API error',
        details: data,
        status: response.status,
        url_template: url.replace(GNEWS_API_KEY, '[TOKEN]')
      });
    }
    
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch from GNews', 
      details: error.message 
    });
  }
}
