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

    const prompt = `You are an expert at explaining political and social news like you're talking to a friend over coffee.

Article Title: "${article.title}"
Article Description: "${article.description}"

User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, ${demographic.detailed.housing}, ${demographic.race} person living in ${demographic.location}.

Explain how this news affects this person in a natural, conversational way. Structure it as a story that flows naturally:

1. Start with the main impact on them personally
2. Add context about challenges or downsides (use phrases like "but here's the catch," "the downside is," "however")
3. Include historical context (use phrases like "back in [year]," "when [place] tried this," "similar to what happened in")

Requirements:
- Write like you're explaining to a friend - casual and conversational
- Use 10th grade language (simple words, short sentences)
- Consider how their race, age, income, housing, and location specifically matter
- Be specific to their demographic situation
- Keep it under 100 words total
- Use "you" and "your"
- Make it flow as one natural paragraph, not separate sections

Example tone: "This new law makes it easier for you to get health insurance through work. But here's the catch - it only applies to companies with 50+ employees, so if you work at a small business, you're out of luck. Back in 2014, Massachusetts tried something similar and it cut uninsured rates by 30%."

Focus on: How does this personally change YOUR daily life?`;

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
        max_tokens: 160,
        temperature: 0.6,
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
