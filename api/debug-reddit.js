// api/debug-reddit.js - Simple auth test
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
      error: 'Missing environment variables',
      envCheck
    });
  }

  try {
    // Test Reddit auth
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const response = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    const responseText = await response.text();
    
    res.json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText,
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
