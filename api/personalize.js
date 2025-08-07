// api/personalize.js - "Bigger Picture" real-world impact analysis
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

    const prompt = `You're analyzing a policy change to show the bigger picture of how it affects real people's daily lives.

Policy: "${article.title}"
Details: "${article.description}"

Write a clear analysis that reveals what news articles typically miss - the concrete impact on regular people. Focus on:

1. What this actually means for people's daily lives (specific costs, changes, timeline)
2. Who gets hurt most and who benefits (be specific about groups of people)
3. The bigger pattern - how this connects to other recent changes affecting the same people
4. What officials aren't emphasizing about the real-world consequences

Use plain English. Be factual and specific about impacts. Avoid jargon. Show the human side of policy changes.

Keep it under 200 words. Write like a journalist who's done the research to connect the dots.`

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
            content: 'You explain government policies in simple terms. You focus on who wins and who loses from policy changes. You write like you\'re talking to a friend, using everyday language that anyone can understand.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 220,
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
