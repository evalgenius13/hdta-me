// api/personalize.js - Enhanced with Redis caching
const { getAnalysis, storeAnalysis } = require('../lib/redis');

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

    // Create cache key
    const cacheKey = `${article.title}-${demographic.age}-${demographic.income}-${demographic.location}`;
    
    // Check Redis cache first
    const cachedAnalysis = await getAnalysis(cacheKey);
    if (cachedAnalysis) {
      console.log('Serving cached analysis');
      return res.status(200).json({ 
        impact: cachedAnalysis,
        cached: true 
      });
    }

    console.log('Generating fresh analysis');

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const prompt = `You are a news analyst who explains how government policies affect regular people.

Article Title: "${article.title}"
Article Description: "${article.description}"

User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Provide analysis in two parts:
1. PERSONAL IMPACT: How this specifically affects someone with their age, income, and state
2. BROADER REALITY: Who gets hurt by this policy, what's not being mentioned, and what similar policies in other states actually resulted in

Requirements:
- Start with direct personal impact
- Explain who benefits and who gets hurt (often not mentioned in articles)
- Point out what's not being said and what that reveals
- Include examples from other states when relevant
- Use simple language, under 180 words total
- Be factual about winners and losers`;

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
      
      // Cache the analysis in Redis
      await storeAnalysis(cacheKey, impact);
      
      res.status(200).json({ 
        impact,
        cached: false
      });
    } else {
      console.error('Unexpected OpenAI response format:', data);
      res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    }

  } catch (error) {
    console.error('Error in personalize API:', error);
    res.status(500).json({ error: 'Failed to generate personalized analysis' });
  }
}
