// api/test-reddit.js - Test endpoint for Phase 1
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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Reddit scanning failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

class RedditScanner {
  constructor() {
    this.clientId = process.env.REDDIT_CLIENT_ID;
    this.clientSecret = process.env.REDDIT_CLIENT_SECRET;
    this.userAgent = process.env.REDDIT_USER_AGENT;
    this.accessToken = null;
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
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error(`Reddit auth failed: ${response.status}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  async getTrendingPolicyStories() {
    await this.authenticate();

    // Get top posts from news and politics subreddits
    const subreddits = ['news', 'politics'];
    const allPosts = [];

    for (const subreddit of subreddits) {
      const posts = await this.getSubredditPosts(subreddit);
      allPosts.push(...posts);
    }

    // Filter for policy relevance and sort by engagement
    const policyPosts = this.filterPolicyRelevant(allPosts);
    const sortedPosts = this.sortByEngagement(policyPosts);

    return sortedPosts.slice(0, 10); // Top 10 for testing
  }

  async getSubredditPosts(subreddit) {
    const url = `https://oauth.reddit.com/r/${subreddit}/hot?limit=25&t=day`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'User-Agent': this.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch r/${subreddit}: ${response.status}`);
    }

    const data = await response.json();
    
    return data.data.children.map(post => ({
      id: post.data.id,
      title: post.data.title,
      url: post.data.url,
      reddit_url: `https://reddit.com${post.data.permalink}`,
      subreddit: post.data.subreddit,
      score: post.data.score,
      num_comments: post.data.num_comments,
      created_utc: post.data.created_utc,
      domain: post.data.domain,
      selftext: post.data.selftext,
      is_self: post.data.is_self
    }));
  }

  filterPolicyRelevant(posts) {
    const policyKeywords = [
      // Government actions
      'congress', 'senate', 'house', 'bill', 'law', 'legislation',
      'supreme court', 'court', 'ruling', 'decision', 'judge',
      'executive order', 'president', 'administration', 'government',
      'regulation', 'rule', 'policy', 'agency', 'department',
      
      // State/Local
      'governor', 'legislature', 'state', 'county', 'city council',
      
      // Policy areas
      'tax', 'healthcare', 'immigration', 'climate', 'energy',
      'education', 'housing', 'transportation', 'trade', 'tariff',
      'social security', 'medicare', 'medicaid', 'unemployment',
      'minimum wage', 'labor', 'union', 'rights', 'civil rights'
    ];

    const excludeKeywords = [
      'sports', 'nfl', 'nba', 'mlb', 'nhl', 'olympics',
      'celebrity', 'kardashian', 'entertainment', 'movie', 'tv show',
      'music', 'album', 'concert', 'gaming', 'video game'
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

      // Only external links (not self posts), good engagement
      return hasPolicyKeyword && 
             !hasExcludedKeyword && 
             !post.is_self && 
             post.score > 100 &&
             this.isNewsSource(post.domain);
    });
  }

  isNewsSource(domain) {
    const newsDomains = [
      'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'npr.org',
      'washingtonpost.com', 'nytimes.com', 'wsj.com', 'bloomberg.com',
      'politico.com', 'axios.com', 'thehill.com', 'cbsnews.com',
      'abcnews.go.com', 'nbcnews.com', 'foxnews.com', 'usatoday.com',
      'latimes.com', 'chicagotribune.com', 'boston.com', 'seattletimes.com'
    ];

    return newsDomains.some(newsDomain => domain.includes(newsDomain));
  }

  sortByEngagement(posts) {
    return posts.sort((a, b) => {
      // Weighted score: upvotes + comment engagement
      const scoreA = a.score + (a.num_comments * 2);
      const scoreB = b.score + (b.num_comments * 2);
      return scoreB - scoreA;
    });
  }
}
