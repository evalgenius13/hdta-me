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

    const prompt = `You are an expert at explaining news in simple, clear language that anyone can understand.

Article Title: "${article.title}"
Article Description: "${article.description}"

User Profile: ${demographic.detailed.age}, ${demographic.detailed.income}, ${demographic.detailed.housing}, living in ${demographic.location}.

Explain how this news affects this person in simple, everyday language. Write like you're talking to a friend over coffee.

Requirements:
- Use 10th grade reading level (simple words, short sentences)
- Be conversational and direct 
- Avoid jargon, complex terms, or financial speak
- Use "you" and "your" 
- Give specific, practical impacts they can understand
- Keep it under 80 words
- Don't use phrases like "may," "could," "might" - be direct about what WILL happen

Examples of simple language:
- Instead of "economic implications" → "money changes"
- Instead of "financial impact" → "affects your wallet" 
- Instead of "mortgage rates" → "home loan costs"
- Instead of "employment trends" → "job market"

Focus on: What happens to YOUR money, YOUR job, YOUR daily life?`;

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
        max_tokens: 120,
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
