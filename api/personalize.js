// api/personalize.js - Simple, working version
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { article } = req.body;
    
    if (!article?.title || !article?.description) {
      return res.status(400).json({ error: 'Missing article data' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    const prompt = `Analyze this news story:

Title: ${article.title}
Summary: ${article.description}

Write a plain English analysis that shows:
1. What's actually happening
2. Who gets hurt most 
3. Who benefits
4. What's not being said

Keep it under 250 words and be direct about winners and losers.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You cut through political spin to show who really wins and loses from policy changes.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    
    if (data.choices?.[0]?.message?.content) {
      return res.json({ impact: data.choices[0].message.content.trim() });
    } else {
      return res.status(500).json({ error: 'Unable to generate analysis' });
    }
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}
