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
    
    if (!GNEWS_API_KEY) {
      res.status(500).json({ error: 'GNews API key not configured' });
      return;
    }

    // Our 7 core categories as keywords
    const query = [
      'congress', 'senate', 'policy', 'federal', 'supreme court',
      'housing policy', 'rent control', 'mortgage rates',
      'healthcare', 'medicare', 'medicaid', 'insurance',
      'student loans', 'education funding', 'college costs',
      'minimum wage', 'jobs', 'inflation', 'recession',
      'tax policy', 'IRS', 'tax credits',
      'gas prices', 'transportation', 'infrastructure'
    ].join(' OR ');

    const params = new URLSearchParams({
      token: GNEWS_API_KEY,
      lang: 'en',
      country: 'us',
      max: 20, // Get extra for filtering
      sortby: 'publishedAt', // Most recent first
      q: query
    });

    const url = `https://gnews.io/api/v4/search?${params}`;
    
    console.log('Fetching from GNews:', url.replace(GNEWS_API_KEY, '[API_KEY]'));
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.articles) {
      // Filter out low-quality articles and duplicates
      const filteredArticles = data.articles.filter(article => 
        article.title && 
        article.description && 
        article.title.length > 20 &&
        article.description.length > 50 &&
        !article.title.toLowerCase().includes('[removed]') &&
        !article.title.toLowerCase().includes('paywall') &&
        // Filter out pure celebrity/sports unless policy-related
        !(
          (article.title.toLowerCase().includes('celebrity') || 
           article.title.toLowerCase().includes('sports') ||
           article.title.toLowerCase().includes('entertainment')) &&
          !(article.title.toLowerCase().includes('policy') ||
            article.title.toLowerCase().includes('law') ||
            article.title.toLowerCase().includes('regulation'))
        )
      );

      // Take top 12 for display
      const articles = filteredArticles.slice(0, 12);
      
      res.status(200).json({ 
        articles,
        source: 'gnews',
        total: articles.length,
        filtered_from: data.articles.length
      });
      
    } else {
      console.error('GNews API error:', data);
      res.status(400).json({ 
        error: data.message || 'Failed to fetch from GNews',
        details: data
      });
    }
    
  } catch (error) {
    console.error('Error fetching news from GNews:', error);
    res.status(500).json({ 
      error: 'Failed to fetch news', 
      details: error.message 
    });
  }
}
