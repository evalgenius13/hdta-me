// Simple in-memory cache
const responseCache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { article, demographic } = req.body;
    
    if (!article || !demographic) {
      res.status(400).json({ error: 'Missing article or demographic data' });
      return;
    }

    // Simple cache key
    const cacheKey = `${article.title}-${demographic.age}-${demographic.income}-${demographic.location}`;
    
    // Check cache first
    if (responseCache.has(cacheKey)) {
      return res.status(200).json({ impact: responseCache.get(cacheKey) });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const prompt = `You are a news analyst who explains how news affects regular people in simple terms.

Article Title: "${article.title}"
Article Description: "${article.description}"
User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Explain how this affects the user personally, then provide broader perspective:

1. Personal impact on your daily life - keep it simple and direct
2. Who's most affected - include how this impacts different racial/ethnic communities

Requirements:
- Use simple, everyday language
- No jargon or technical terms  
- Keep it conversational but not chatty
- Start with direct personal impact
- Include analysis of racial/ethnic impacts in current political climate
- Keep under 150 words total
- Be practical and specific`;

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
            content: 'You are a professional news analyst. Provide direct, factual analysis without casual greetings or conversational filler.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      res.status(response.status).json({ error: 'OpenAI API request failed' });
      return;
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const impact = data.choices[0].message.content.trim();
      
      // Cache the response
      responseCache.set(cacheKey, impact);
      
      res.status(200).json({ impact });
    } else {
      console.error('Unexpected OpenAI response format:', data);
      res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    }
  } catch (error) {
    console.error('Error in personalize API:', error);
    res.status(500).json({ error: 'Failed to generate personalized analysis' });
  }
}
