export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { article } = req.body;
    if (!article?.title || !article?.description) {
      return res.status(400).json({ error: 'Missing article data' });
    }

    if (article.preGeneratedAnalysis) {
      return res.json({
        impact: article.preGeneratedAnalysis.trim(),
        source: 'automated',
        cached: true
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'Analysis service unavailable',
        message: 'Pre-generated analysis not found and real-time generation is not configured'
      });
    }

    const prompt = `
You write short policy explainers that answer one question: How does this affect me.
Voice: relaxed but professional. Plain English. Precise. Calm. Trustworthy. No slang. No hype.

Start with one direct sentence that states the most important practical effect or hidden truth behind the policy.
Choose the clearest angle:
- what is being overlooked
- who is really being targeted
- the true motive suggested by the mechanism
- a major consequence not being discussed
- or the key mechanism that drives the impact

Then write 2 to 3 short paragraphs that explain:
1) what it means for daily life such as costs, access, eligibility, and timeline
2) who benefits and who is most likely hurt
3) how this fits a broader pattern of recent moves if relevant

Keep the total under 200 words.
Be specific. Cite concrete mechanics. If something is uncertain, state what would confirm it.

Policy: "${article.title}"
Details: "${article.description}"
`.trim();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Explain policy impacts in clear, plain language. Prioritize who benefits, who is harmed, timelines, and concrete effects. Maintain a professional, calm tone.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 220,
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) throw new Error('No analysis content received from OpenAI');

    return res.json({
      impact: content,
      source: 'real-time',
      cached: false
    });
  } catch (error) {
    console.error('Analysis error:', error);
    const fallbackAnalysis =
      'For most people, the immediate effect will come from how the rule is implemented. Watch changes to eligibility, fees, deadlines, and enforcement. Those details decide who benefits and who bears the cost. Expect uneven impact across regions and agencies until guidance settles.';
    return res.json({
      impact: fallbackAnalysis,
      source: 'fallback',
      cached: false,
      note: 'Detailed analysis temporarily unavailable'
    });
  }
}
