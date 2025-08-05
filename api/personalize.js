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

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const prompt = `You are a professional news analyst who explains policy and economic news clearly and directly.

Article Title: "${article.title}"
Article Description: "${article.description}"
User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, ${demographic.detailed.housing}, ${demographic.race} person living in ${demographic.location}.

Provide a complete analysis with two parts:

1. HOW THIS AFFECTS YOU: Explain the specific personal impact. Be direct and factual. DO NOT mention specific demographic categories - just explain the impact naturally.

2. WHAT'S NOT MENTIONED: Point out 2-3 key details the article doesn't include that matter.

Structure like this:
[Direct explanation of impact - no demographic labels, just natural explanation]

What's not mentioned: [2-3 bullet points of missing information]

Requirements:
- Be professional but approachable
- NO casual greetings or demographic references
- Start directly with the impact
- Use "you" and "your" naturally
- Keep total response under 200 words
- Be factual, not speculative`;

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
        max_tokens: 250,
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
