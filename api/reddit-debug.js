// api/reddit-debug.js - Debug why no stories found
export default async function handler(req, res) {
  const debug = {
    timestamp: new Date().toISOString(),
    tests: []
  };

  // Test 1: Can we get ANY posts from Reddit?
  try {
    const response = await fetch('https://www.reddit.com/r/news/top.json?t=day&limit=5', {
      headers: {
        'User-Agent': 'policy-scanner/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const posts = data.data.children || [];
      
      debug.tests.push({
        test: 'Reddit API Access',
        success: true,
        postsFound: posts.length,
        sampleTitles: posts.slice(0, 3).map(p => p.data.title)
      });
      
      // Test 2: Check what keywords we find
      const allTitles = posts.map(p => p.data.title.toLowerCase());
      const policyWords = ['congress', 'senate', 'bill', 'law', 'court', 'president', 'government', 'policy', 'tax', 'healthcare'];
      const foundKeywords = policyWords.filter(word => 
        allTitles.some(title => title.includes(word))
      );
      
      debug.tests.push({
        test: 'Policy Keywords Found',
        foundKeywords: foundKeywords,
        totalKeywordsChecked: policyWords.length
      });
      
      // Test 3: Show scores
      const scores = posts.map(p => ({ title: p.data.title.substring(0, 50), score: p.data.score }));
      debug.tests.push({
        test: 'Post Scores',
        scores: scores
      });
      
    } else {
      debug.tests.push({
        test: 'Reddit API Access',
        success: false,
        status: response.status,
        statusText: response.statusText
      });
    }
  } catch (error) {
    debug.tests.push({
      test: 'Reddit API Access',
      success: false,
      error: error.message
    });
  }

  res.json(debug);
}
