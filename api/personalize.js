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

    const prompt = `You're explaining this news story to a friend who wants to know what's really going on.

Title: ${article.title}
Summary: ${article.description}

Write like you're having a conversation - cut through the political BS and show who actually wins and loses. 

Cover: What's really happening here, who gets screwed over, who benefits and how, and what they're not telling us.

Keep it under 200 words. Use simple language. Be direct about the real impact on regular people.`;

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
            content: 'You explain complex news like a smart friend who sees through political spin. You use simple words and show who really benefits vs who pays the price.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 250,
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
