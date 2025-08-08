export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

    // Serve pre-generated analysis if present
    if (article.preGeneratedAnalysis) {
      return res.json({
        impact: article.preGeneratedAnalysis.trim(),
        source: 'automated',
        cached: true
      });
    }

    // Generate on-demand if needed
    if (article.isAnalyzed === false || !article.preGeneratedAnalysis) {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_API_KEY) {
        return res.status(500).json({
          error: 'Analysis service unavailable',
          message: 'Pre-generated analysis not found and real-time generation is not configured'
        });
      }

      const prompt = `
You write short policy explainers that reveal the real driver behind a move.
Voice: relaxed but professional, plain English, precise, calm, and trustworthy. No slang. No hype.

Start with one direct sentence that states the most important hidden truth or motive behind the policy.
This lead can highlight:
- what’s being overlooked
- who’s really being targeted
- the true motive behind the change
- a major consequence not being discussed

Then add 2–3 short paragraphs that explain:
1) what it means for daily life (costs, access, changes, timelines)
2) who benefits and who is likely hurt the most
3) how this fits a broader pattern

Keep it under 200 words total.

Policy: "${article.title}"
Details: "${article.description}"
`.trim();

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Explain policy impacts in clear, plain language. Be specific and concise. Prioritize who benefits, who is harmed, timelines, and concrete effects. Maintain a professional, calm tone.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 220,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();

      if (content) {
        return res.json({
          impact: content,
          source: 'real-time',
          cached: false
        });
      }

      throw new Error('No analysis content received from OpenAI');
    }

    return res.status(500).json({
      error: 'Unable to provide analysis',
      message: 'Analysis not available for this article'
    });
  } catch (error) {
    console.error('Analysis error:', error);
    const fallbackAnalysis =
      'Here is the likely bottom line. The move changes who gets access and on what terms, and it shifts costs and timelines in ways that will be clearer as rules are implemented. Watch who qualifies, who has to wait longer, and which agencies enforce the changes. Those details will decide who benefits and who carries the burden.';
    return res.json({
      impact: fallbackAnalysis,
      source: 'fallback',
      cached: false,
      note: 'Detailed analysis temporarily unavailable'
    });
  }
}
