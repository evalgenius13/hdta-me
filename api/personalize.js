export default async function handler(req, res) {
  // Set CORS headers
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

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const prompt = `You are an expert at explaining how news affects different demographics. 

Article Title: "${article.title}"
Article Description: "${article.description}"

User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, ${demographic.detailed.housing}, living in ${demographic.location}.

Write a concise, conversational explanation (2-3 sentences) of how this specific news story affects this person's daily life, finances, or future plans. Be specific and actionable. Don't use phrases like "may" or "could" - be direct about the likely impacts.

Focus on:
- Immediate practical effects (within weeks/months)
- Financial impact on their specific situation
- What they should consider doing about it
- Local/regional implications if relevant

Keep it under 100 words and write in second person ("you").`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that explains news impacts in clear, practical terms for specific demographics.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', response.status, errorData);
      res.status(response.status).json({ error: 'OpenAI API request failed' });
      return;
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const impact = data.choices[0].message.content.trim();
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
