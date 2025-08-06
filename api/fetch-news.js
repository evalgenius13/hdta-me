// api/fetch-news.js - With full article scraping
const { getNewsList, storeNewsList, storeFullArticle } = require('../lib/redis');

// Extract clean text from HTML
function extractArticleText(html) {
  // Remove script and style tags
  const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                       .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove HTML tags but keep text
  const textOnly = cleanHtml.replace(/<[^>]*>/g, ' ')
                           .replace(/\s+/g, ' ')
                           .trim();
  
  // Return first 3000 characters (roughly 600-800 tokens)
  return textOnly.substring(0, 3000);
}

// Scrape article content with ScrapingBee
async function scrapeArticle(url) {
  try {
    const scrapingUrl = `https://app.scrapingbee.com/api/v1/?api_key=${process.env.SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(url)}`;
    
    const response = await fetch(scrapingUrl);
    if (!response.ok) {
      throw new Error(`ScrapingBee error: ${response.status}`);
    }
    
    const html = await response.text();
    const cleanText = extractArticleText(html);
    
    if (cleanText.length < 200) {
      throw new Error('Article too short - extraction likely failed');
    }
    
    return cleanText;
  } catch (error) {
    console.error(`Scraping failed for ${url}:`, error.message);
    return null;
  }
}

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
      console.log('Serving cached news with full articles');
      return res.status(200).json({ 
        articles: cachedNews,
        cached: true 
      });
    }

    console.log('Fetching fresh news and scraping articles');

    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    const query = 'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.articles) {
      return res.status(400).json({ error: data.error || 'No articles found' });
    }

    // Filter articles
    let articles = data.articles.filter(article => 
      article.title && 
      article.description && 
      !article.title.includes('[Removed]') &&
      !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
      (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
    );

    console.log(`Scraping ${articles.length} articles...`);

    // Scrape full content for each article
    const scrapingResults = await Promise.allSettled(
      articles.map(async (article) => {
        const fullContent = await scrapeArticle(article.url);
        
        if (fullContent) {
          // Store full article in Redis
          await storeFullArticle(article.url, fullContent);
          return {
            ...article,
            hasFullContent: true
          };
        } else {
          return {
            ...article,
            hasFullContent: false
          };
        }
      })
    );

    // Process results
    const enhancedArticles = scrapingResults
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    // Cache the enhanced news list
    await storeNewsList(enhancedArticles);

    const successCount = enhancedArticles.filter(a => a.hasFullContent).length;
    console.log(`Successfully scraped ${successCount}/${enhancedArticles.length} articles`);

    res.status(200).json({ 
      articles: enhancedArticles,
      cached: false,
      stats: {
        total: enhancedArticles.length,
        scraped: successCount,
        failed: enhancedArticles.length - successCount
      }
    });

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
};
