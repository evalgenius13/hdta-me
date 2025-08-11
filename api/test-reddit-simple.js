// api/test-reddit-simple.js - Simple test endpoint
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const testResults = {
    timestamp: new Date().toISOString(),
    tests: []
  };

  // Test 1: Environment variables
  const envTest = {
    name: 'Environment Variables',
    hasClientId: !!process.env.REDDIT_CLIENT_ID,
    hasClientSecret: !!process.env.REDDIT_CLIENT_SECRET,
    hasUserAgent: !!process.env.REDDIT_USER_AGENT,
    userAgent: process.env.REDDIT_USER_AGENT || 'hdta-news-scanner/1.0.0'
  };
  testResults.tests.push(envTest);

  // Test 2: Public JSON endpoint (no auth)
  let jsonTest = { name: 'Public JSON Endpoint' };
  try {
    const response = await fetch('https://www.reddit.com/r/news/hot.json?limit=3', {
      headers: {
        'User-Agent': envTest.userAgent,
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const posts = data?.data?.children || [];
      jsonTest = {
        ...jsonTest,
        success: true,
        status: response.status,
        postsFound: posts.length,
        sampleTitle: posts[0]?.data?.title || 'No posts found'
      };
    } else {
      jsonTest = {
        ...jsonTest,
        success: false,
        status: response.status,
        error: await response.text()
      };
    }
  } catch (error) {
    jsonTest = {
      ...jsonTest,
      success: false,
      error: error.message
    };
  }
  testResults.tests.push(jsonTest);

  // Test 3: Policy filtering test
  const samplePosts = [
    { title: "Congress passes new healthcare bill", score: 1500, num_comments: 200 },
    { title: "Lakers win championship game", score: 2000, num_comments: 300 },
    { title: "Supreme Court rules on voting rights", score: 1200, num_comments: 150 }
  ];

  const policyKeywords = ['congress', 'supreme court', 'healthcare', 'voting rights'];
  const excludeKeywords = ['lakers', 'championship', 'game', 'sports'];

  const filteredPosts = samplePosts.filter(post => {
    const text = post.title.toLowerCase();
    const hasPolicy = policyKeywords.some(k => text.includes(k));
    const hasExcluded = excludeKeywords.some(k => text.includes(k));
    return hasPolicy && !hasExcluded;
  });

  const filterTest = {
    name: 'Policy Filtering Logic',
    success: true,
    originalPosts: samplePosts.length,
    filteredPosts: filteredPosts.length,
    expectedFiltered: 2, // Should filter out Lakers post
    filterWorking: filteredPosts.length === 2
  };
  testResults.tests.push(filterTest);

  // Test 4: Reddit API auth (if credentials available)
  let authTest = { name: 'Reddit API Authentication' };
  if (envTest.hasClientId && envTest.hasClientSecret) {
    try {
      const auth = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
      
      const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'User-Agent': envTest.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'grant_type': 'client_credentials',
          'scope': 'read'
        }).toString()
      });

      if (response.ok) {
        const data = await response.json();
        authTest = {
          ...authTest,
          success: true,
          hasToken: !!data.access_token,
          tokenType: data.token_type,
          expiresIn: data.expires_in
        };
      } else {
        authTest = {
          ...authTest,
          success: false,
          status: response.status,
          error: await response.text()
        };
      }
    } catch (error) {
      authTest = {
        ...authTest,
        success: false,
        error: error.message
      };
    }
  } else {
    authTest = {
      ...authTest,
      skipped: true,
      reason: 'No Reddit API credentials provided (will use public endpoints)'
    };
  }
  testResults.tests.push(authTest);

  // Overall assessment
  const successfulTests = testResults.tests.filter(t => t.success && !t.skipped).length;
  const totalTests = testResults.tests.filter(t => !t.skipped).length;
  
  testResults.summary = {
    allTestsPassed: successfulTests === totalTests,
    successfulTests,
    totalTests,
    readyForPhase1: jsonTest.success && filterTest.filterWorking,
    nextSteps: []
  };

  if (!jsonTest.success) {
    testResults.summary.nextSteps.push("Fix Reddit JSON endpoint access");
  }
  if (!filterTest.filterWorking) {
    testResults.summary.nextSteps.push("Debug policy filtering logic");
  }
  if (testResults.summary.readyForPhase1) {
    testResults.summary.nextSteps.push("Deploy reddit-trending.js endpoint", "Test with live data", "Integrate with daily workflow");
  }

  res.json(testResults);
}

// Quick function to test individual components
export function testPolicyFilter(title) {
  const policyKeywords = [
    'congress', 'senate', 'house', 'bill', 'law', 'legislation',
    'supreme court', 'court', 'ruling', 'decision', 'judge',
    'executive order', 'president', 'administration', 'government',
    'regulation', 'rule', 'policy', 'agency', 'department'
  ];

  const excludeKeywords = [
    'sports', 'nfl', 'nba', 'mlb', 'celebrity', 'entertainment',
    'music', 'movie', 'gaming', 'crypto', 'bitcoin'
  ];

  const text = title.toLowerCase();
  const hasPolicy = policyKeywords.some(k => text.includes(k));
  const hasExcluded = excludeKeywords.some(k => text.includes(k));
  
  return {
    title,
    hasPolicy,
    hasExcluded,
    shouldInclude: hasPolicy && !hasExcluded,
    matchedPolicyKeywords: policyKeywords.filter(k => text.includes(k)),
    matchedExcludeKeywords: excludeKeywords.filter(k => text.includes(k))
  };
}
