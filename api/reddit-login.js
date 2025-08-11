// api/reddit-login.js - Redirect to Reddit for authorization
export default function handler(req, res) {
  const { REDDIT_CLIENT_ID, REDDIT_REDIRECT_URI } = process.env;
  
  if (!REDDIT_CLIENT_ID || !REDDIT_REDIRECT_URI) {
    return res.status(500).json({ error: 'Missing Reddit OAuth config' });
  }
  
  const url = new URL('https://www.reddit.com/api/v1/authorize');
  url.searchParams.set('client_id', REDDIT_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', 'hdta123');
  url.searchParams.set('redirect_uri', REDDIT_REDIRECT_URI);
  url.searchParams.set('duration', 'temporary');
  url.searchParams.set('scope', 'read');
  
  res.redirect(url.toString());
}

// api/debug-reddit.js - Handle the OAuth callback and exchange code for token
export default async function handler(req, res) {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT, REDDIT_REDIRECT_URI } = process.env;
  const { code } = req.query; // send ?code=... to this route after you authorize

  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USER_AGENT || !REDDIT_REDIRECT_URI) {
    return res.status(500).json({ success: false, error: 'Missing env vars' });
  }

  if (!code) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing ?code parameter',
      help: 'First visit /api/reddit-login to get authorization code'
    });
  }

  const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  
  const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'User-Agent': REDDIT_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      'grant_type': 'authorization_code',
      'code': code,
      'redirect_uri': REDDIT_REDIRECT_URI
    })
  });

  const txt = await resp.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {}

  if (!resp.ok) {
    return res.status(resp.status).json({ success: false, status: resp.status, body: txt });
  }

  // Test the token
  const token = json.access_token;
  const test = await fetch('https://oauth.reddit.com/api/v1/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': REDDIT_USER_AGENT
    }
  });

  const me = await test.json();

  return res.json({
    success: true,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
    me
  });
}
