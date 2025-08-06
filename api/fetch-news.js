// api/fetch-news.js - Conservative scraping implementation
const { getNewsList, storeNewsList, storeFullArticle, getFullArticle } = require('../lib/redis');

// Calculate similarity between two strings (simple approach)
function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(str2.split(' ').filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size; // Jaccard similarity
}

// Extract key policy content from HTML
function extractPolicyContent(html) {
  // Remove scripts, styles, ads, navigation
  let cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                     .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                     .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                     .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
                     .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
  
  // Extract text and clean up
  const textOnly = cleanHtml.replace(/<[^>]*>/g, ' ')
                           .replace(/\s+/g, ' ')
                           .replace(/\n+/g, ' ')
                           .trim();
  
  // Focus on policy-relevant content - first 2000 chars usually contain the meat
  const policyText = textOnly.substring(0, 2000);
  
  // Basic quality check
  if (policyText.length < 300) {
    throw new Error('Extracted content too short - likely failed');
  }
  
  return policyText;
}

// Scrape single article with conservative approach
async function scrapeArticleConservatively(url) {
  try {
    // Always check cache first
    const cachedContent = await getFullArticle(url);
    if (cachedContent) {
      return cachedContent;
    }

    console.log(`Attempting to scrape: ${url}`);
    
    const scrapingUrl = `https://app.scrapingbee.com/api/v1/?api_key=${process.env.SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(url)}&render_js=false`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch(scrapingUrl, { 
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const policyContent = extractPolicyContent(html);
    
    // Cache successful extraction
    await storeFullArticle(url, policyContent);
    console.log(`Successfully scraped and cached: ${url}`);
    
    return policyContent;
    
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
    // Check news cache first (8 hours)
    const cachedNews = await getNewsList();
    if (cachedNews) {
      console.log('Serving cached news with enhanced articles');
      return res.status(200).json({ 
        articles: cachedNews,
        cached: true 
      });
    }

    console.log('Fetching fresh news and attempting article enhancement');

    const API_KEY = process.env.GNEWS_API_KEY || '050022879499fff60e9b870bf150a377';
    
    const query = 'congress OR senate OR governor OR "bill signed" OR "supreme court" OR "executive order" OR regulation OR "rule change" OR EPA OR FDA OR IRS OR "federal agency"';
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.articles) {
      return res.status(400).json({ error: data.error || 'No articles found' });
    }

    // Filter and deduplicate articles
    let articles = data.articles.filter(article => 
      article.title && 
      article.description && 
      !article.title.includes('[Removed]') &&
      !(/golf|nfl|nba|ncaa|sports|celebrity|stocks|earnings|rapper|music|movie|entertainment/i.test(article.title)) &&
      (/bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves/i.test(article.title + ' ' + article.description))
    );

    // Remove duplicates based on similar titles
    const seenTitles = new Set();
    articles = articles.filter(article => {
      // Normalize title for comparison (remove common words, lowercase, trim)
      const normalizedTitle = article.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '') // Remove common words
        .replace(/\s+/g, ' ')
        .trim();
      
      // Check for similar titles (handle slight variations)
      for (const seenTitle of seenTitles) {
        const similarity = calculateSimilarity(normalizedTitle, seenTitle);
        if (similarity > 0.8) { // 80% similarity threshold
          return false; // Skip this duplicate
        }
      }
      
      seenTitles.add(normalizedTitle);
      return true;
    });

    console.log(`After deduplication: ${articles.length} unique policy articles`);

    // Conservative approach: Only try to scrape 3 articles with significant delays
    const articlesToEnhance = articles.slice(0, 3);
    const basicArticles = articles.slice(3);

    // Process articles with delays to respect rate limits
    const enhancedArticles = [];
    
    for (let i = 0; i < articlesToEnhance.length; i++) {
      const article = articlesToEnhance[i];
      
      // Add 4-second delay between requests (very conservative)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
      
      const fullContent = await scrapeArticleConservatively(article.url);
      
      enhancedArticles.push({
        ...article,
        hasFullContent: !!fullContent
      });
    }

    // Combine enhanced and basic articles
    const allArticles = [
      ...enhancedArticles,
      ...basicArticles.map(article => ({
        ...article,
        hasFullContent: false
      }))
    ];

    // Cache the results for 8 hours
    await storeNewsList(allArticles);

    const enhancedCount = enhancedArticles.filter(a => a.hasFullContent).length;
    console.log(`Enhanced ${enhancedCount}/${articlesToEnhance.length} articles with full content`);

    res.status(200).json({ 
      articles: allArticles,
      cached: false,
      enhancement_stats: {
        total_articles: allArticles.length,
        enhancement_attempts: articlesToEnhance.length,
        successful_enhancements: enhancedCount,
        basic_articles: basicArticles.length
      }
    });

  } catch (error) {
    console.error('Fetch news error:', error);
    res.status(500).json({ error: 'Failed to fetch and enhance news' });
  }
};
