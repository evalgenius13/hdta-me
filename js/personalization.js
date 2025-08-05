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

    const prompt = `You are an expert at explaining political and social news in a helpful, friendly way.

Article Title: "${article.title}"
Article Description: "${article.description}"
User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, ${demographic.detailed.housing}, ${demographic.race} person living in ${demographic.location}.

Provide a complete analysis with two parts:

1. HOW THIS AFFECTS YOU: Explain the personal impact on this specific person. Be conversational and specific to their situation.

2. BETWEEN THE LINES: Point out 2-3 key things the article doesn't mention that matter (missing costs, timelines, who really benefits, etc.).

Structure like this:
[Personal impact paragraph]

But here's what they're not telling you: [2-3 bullet points of missing info]

Requirements:
- Write like you're explaining to a friend
- Use 10th grade language
- Consider their specific demographics
- Keep total response under 150 words
- Use "you" and "your"
- Be factual, not conspiratorial`;

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
            content: 'You are a helpful assistant that explains news impacts clearly and points out missing information.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.6,
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
