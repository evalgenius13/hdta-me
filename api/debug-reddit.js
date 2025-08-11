// api/debug-reddit.js - Test Web app auth with client_credentials
export default async function handler(req, res) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT;

  // Check if env vars are loaded
  const envCheck = {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    hasUserAgent: !!userAgent,
    clientIdLength: clientId?.length || 0,
    secretLength: clientSecret?.length || 0
  };

  if (!clientId || !clientSecret || !userAgent) {
    return res.json({
      success: false,
      error: 'Missing environment variables for Web app',
      envCheck,
      required: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT']
    });
  }

  try {
    // Web app authentication - use client_credentials grant
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        'grant_type': 'client_credentials',
        'scope': 'read'
      }).toString()
    });

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    // If we got a token, test it on a public endpoint
    let testResult = null;
    if (response.ok && responseJson?.access_token) {
      try {
        const testResponse = await fetch('https://oauth.reddit.com/r/news/top?limit=1', {
          headers: {
            'Authorization': `Bearer ${responseJson.access_token}`,
            'User-Agent': userAgent
          }
        });
        const testData = testResponse.ok ? await testResponse.json() : await testResponse.text();
        testResult = {
          status: testResponse.status,
          ok: testResponse.ok,
          dataPreview: testResponse.ok ? 'API test successful - got Reddit data' : testData
        };
      } catch (testError) {
        testResult = { error: testError.message };
      }
    }
    
    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText,
      hasToken: !!responseJson?.access_token,
      tokenTest: testResult,
      envCheck
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      envCheck
    });
  }
}
