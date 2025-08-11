// api/reddit-trending.js - Complete Reddit integration with fallback strategies
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const scanner = new RedditScanner();
    const trendingStories = await scanner.getTrendingPolicyStories();
    
    res.json({
      success: true,
      count: trendingStories.length,
      stories: trendingStories,
      timestamp: new Date().toISOString(),
      source: scanner.lastUsedMethod
    });
  } catch (error) {
    console.error('Reddit scanning failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

class RedditScanner {
  constructor() {
    this.clientId = process.env.REDDIT_CLIENT_ID;
    this.clientSecret = process.env.REDDIT_CLIENT_SECRET;
    this.userAgent = process.env.REDDIT_USER_AGENT || 'hdta-news-scanner/1.0.0';
    this.accessToken = null;
    this.lastUsedMethod = null;
  }

  async getTrendingPolicyStories() {
    // Try multiple strategies in order of preference
    const strategies = [
      () => this.getStoriesViaAPI(),
      () => this.getStoriesViaPublicJSON(),
      () => this.getStoriesViaDirectFetch()
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.length > 0) {
          return result;
        }
      } catch (error) {
        console.warn('Strategy failed, trying next:', error.message);
        continue;
      }
    }

    throw new Error('All Reddit data collection strategies failed');
  }

  // Strategy 1: Official Reddit API with OAuth
  async getStoriesViaAPI() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Missing Reddit API credentials');
    }

    await this.authenticate();
    const allPosts = [];

    // Get posts from multiple subreddits
    const subreddits = ['news', 'politics', 'worldnews'];
    
    for (const subreddit of subreddits) {
      try {
        const posts = await this.getSubredditPostsAPI(subreddit);
        allPosts.push(...posts);
      } catch (error) {
        console.warn(`Failed to get r/${subreddit} via API:`, error.message);
      }
    }

    this.lastUsedMethod = 'official_api';
    return this.processPosts(allPosts);
  }

  // Strategy 2: Public JSON endpoints (no auth required)
  async getStoriesViaPublicJSON() {
    const allPosts = [];
    const subreddits = ['news', 'politics', 'worldnews'];
    
    for (const subreddit of subreddits) {
      try {
        const posts = await this.getSubredditPostsJSON(subreddit);
        allPosts.push(...posts);
      } catch (error) {
        console.warn(`Failed to get r/${subreddit} via JSON:`, error.message);
      }
    }

    this.lastUsedMethod = 'public_json';
    return this.processPosts(allPosts);
  }

  // Strategy 3: Direct fetch with user agent
  async getStoriesViaDirectFetch() {
    const allPosts = [];
    const subreddits = ['news', 'politics'];
    
    for (const subreddit of subreddits) {
      try {
        const posts = await this.getSubredditPostsDirect(subreddit);
        allPosts.push(...posts);
      } catch (error) {
        console.warn(`Failed to get r/${subreddit} direct:`, error.message);
      }
    }

    this.lastUsedMethod = 'direct_fetch';
    return this.processPosts(allPosts);
  }

  async authenticate() {
    if (this.accessToken) return this.accessToken;

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'User-Agent': this.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'grant_type': 'client_credentials',
        'scope': 'read'
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Reddit auth failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    
    // Set expiration timer
    setTimeout(() => {
      this.accessToken = null;
    }, (data.expires_in - 60) * 1000); // Refresh 1 minute early
    
    return this.accessToken;
  }

  async getSubredditPostsAPI(subreddit) {
    const url = `https://oauth.reddit.com/r/${subreddit}/hot?limit=25&t=day`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.parseRedditPosts(data);
  }

  async getSubredditPostsJSON(subreddit) {
    // Use Reddit's public JSON API (no auth required)
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&t=day`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`JSON request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.parseRedditPosts(data);
  }

  async getSubredditPostsDirect(subreddit) {
    // Fallback: direct fetch with careful headers
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=20`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`Direct request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.parseRedditPosts(data);
  }

  parseRedditPosts(data) {
    if (!data?.data?.children) {
      throw new Error('Invalid Reddit response format');
    }

    return data.data.children.map(post => ({
      id: post.data.id,
      title: post.data.title,
      url: post.data.url,
      reddit_url: `https://reddit.com${post.data.permalink}`,
      subreddit: post.data.subreddit,
      score: post.data.score || 0,
      num_comments: post.data.num_comments || 0,
      created_utc: post.data.created_utc,
      domain: post.data.domain,
      selftext: post.data.selftext || '',
      is_self: post.data.is_self || false,
      author: post.data.author,
      upvote_ratio: post.data.upvote_ratio || 0
    }));
  }

  processPosts(allPosts) {
    // Filter for policy relevance
    const policyPosts = this.filterPolicyRelevant(allPosts);
    
    // Sort by engagement and recency
    const sortedPosts = this.sortByEngagement(policyPosts);
    
    // Return top stories with metadata
    return sortedPosts.slice(0, 10).map(post => ({
      ...post,
      engagement_score: this.calculateEngagementScore(post),
      policy_relevance_score: this.calculatePolicyRelevance(post),
      hours_old: this.getHoursOld(post.created_utc)
    }));
  }

  filterPolicyRelevant(posts) {
    const policyKeywords = [
      // Core government terms
      'congress', 'senate', 'house', 'bill', 'law', 'legislation',
      'supreme court', 'court', 'ruling', 'decision', 'judge',
      'executive order', 'president', 'administration', 'government',
      'regulation', 'rule', 'policy', 'agency', 'department',
      
      // State/Local government
      'governor', 'legislature', 'state', 'mayor', 'city council',
      
      // Policy areas that affect individuals
      'tax', 'taxes', 'healthcare', 'immigration', 'climate', 'energy',
      'education', 'housing', 'transportation', 'trade', 'tariff',
      'social security', 'medicare', 'medicaid', 'unemployment',
      'minimum wage', 'labor', 'union', 'civil rights', 'voting',
      
      // Economic policy
      'federal reserve', 'interest rate', 'inflation', 'economy',
      'budget', 'spending', 'debt ceiling', 'stimulus'
    ];

    const excludeKeywords = [
      'sports', 'nfl', 'nba', 'mlb', 'nhl', 'olympics', 'soccer',
      'celebrity', 'kardashian', 'entertainment', 'movie', 'tv show',
      'music', 'album', 'concert', 'gaming', 'video game', 'crypto',
      'stock', 'bitcoin', 'tesla', 'musk', 'bezos'
    ];

    return posts.filter(post => {
      const text = (post.title + ' ' + post.selftext).toLowerCase();
      
      // Must have policy relevance
      const hasPolicyKeyword = policyKeywords.some(keyword => 
        text.includes(keyword.toLowerCase())
      );
      
      // Must not be excluded content
      const hasExcludedKeyword = excludeKeywords.some(keyword => 
        text.includes(keyword.toLowerCase())
      );

      // Quality filters
      const hasGoodEngagement = post.score > 50 && post.num_comments > 5;
      const isExternalLink = !post.is_self && this.isValidNewsSource(post.domain);
      const isRecentEnough = this.getHoursOld(post.created_utc) < 48;

      return hasPolicyKeyword && 
             !hasExcludedKeyword && 
             hasGoodEngagement &&
             isExternalLink &&
             isRecentEnough;
    });
  }

  isValidNewsSource(domain) {
    if (!domain) return false;
    
    const trustedDomains = [
      // Major news outlets
      'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'npr.org',
      'washingtonpost.com', 'nytimes.com', 'wsj.com', 'bloomberg.com',
      'axios.com', 'thehill.com', 'politico.com',
      
      // Broadcast news
      'cbsnews.com', 'abcnews.go.com', 'nbcnews.com', 'foxnews.com',
      
      // Regional/Local
      'usatoday.com', 'latimes.com', 'chicagotribune.com', 'seattletimes.com',
      
      // Government sources
      'whitehouse.gov', 'congress.gov', 'supremecourt.gov', 'cdc.gov',
      
      // Wire services
      'ap.org', 'reuters.com'
    ];

    return trustedDomains.some(trusted => domain.includes(trusted)) ||
           domain.includes('.gov') ||
           domain.includes('news') ||
           domain.includes('times');
  }

  calculateEngagementScore(post) {
    // Weighted engagement score
    const scoreWeight = 1;
    const commentWeight = 3;
    const ratioBonus = post.upvote_ratio > 0.8 ? 1.2 : 1;
    const recencyBonus = post.hours_old < 12 ? 1.5 : 1;
    
    return (post.score * scoreWeight + post.num_comments * commentWeight) * ratioBonus * recencyBonus;
  }

  calculatePolicyRelevance(post) {
    const text = (post.title + ' ' + post.selftext).toLowerCase();
    let score = 0;
    
    // High value terms
    const highValueTerms = ['supreme court', 'executive order', 'congress passes', 'bill signed'];
    highValueTerms.forEach(term => {
      if (text.includes(term)) score += 10;
    });
    
    // Medium value terms
    const mediumValueTerms = ['regulation', 'policy', 'law', 'ruling', 'decision'];
    mediumValueTerms.forEach(term => {
      if (text.includes(term)) score += 5;
    });
    
    return score;
  }

  sortByEngagement(posts) {
    return posts.sort((a, b) => {
      const scoreA = this.calculateEngagementScore(a);
      const scoreB = this.calculateEngagementScore(b);
      return scoreB - scoreA;
    });
  }

  getHoursOld(created_utc) {
    if (!created_utc) return 999;
    return Math.floor((Date.now() / 1000 - created_utc) / 3600);
  }
}

// Test function for development
export async function testRedditIntegration() {
  const scanner = new RedditScanner();
  try {
    const stories = await scanner.getTrendingPolicyStories();
    console.log(`✅ Successfully got ${stories.length} stories via ${scanner.lastUsedMethod}`);
    console.log('Sample story:', stories[0]);
    return { success: true, count: stories.length, method: scanner.lastUsedMethod };
  } catch (error) {
    console.error('❌ Reddit integration test failed:', error);
    return { success: false, error: error.message };
  }
}
