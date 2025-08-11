// api/reddit-policy-stories.js - Simple Phase 1: Get top 5-10 policy stories
export default async function handler(req, res) {
  try {
    const stories = await getTopPolicyStories();
    
    res.json({
      success: true,
      count: stories.length,
      stories: stories,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getTopPolicyStories() {
  // Get top posts from news subreddits
  const allPosts = [];
  const subreddits = ['news', 'politics'];
  
  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/top.json?t=day&limit=20`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'policy-scanner/1.0',
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const posts = data.data.children.map(post => ({
          title: post.data.title,
          url: post.data.url,
          score: post.data.score,
          comments: post.data.num_comments,
          domain: post.data.domain,
          subreddit: post.data.subreddit
        }));
        allPosts.push(...posts);
      }
    } catch (error) {
      console.warn(`Failed r/${sub}:`, error.message);
    }
  }
  
  // Filter for policy relevance
  const policyPosts = allPosts.filter(post => {
    const text = post.title.toLowerCase();
    
    // Must have policy keywords
    const policyWords = ['congress', 'senate', 'bill', 'law', 'court', 'president', 'government', 'policy', 'tax', 'healthcare'];
    const hasPolicy = policyWords.some(word => text.includes(word));
    
    // Must not have excluded words
    const excludeWords = ['sports', 'nfl', 'nba', 'celebrity', 'entertainment'];
    const hasExcluded = excludeWords.some(word => text.includes(word));
    
    return hasPolicy && !hasExcluded && post.score > 100;
  });
  
  // Sort by score and return top 10
  return policyPosts
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
