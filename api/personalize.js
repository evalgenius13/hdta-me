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
        message: 'Real-time generation is not configured'
      });
    }

    const prompt = `
You write short policy explainers that answer one question: How does this affect me.
Voice: relaxed but professional. Plain English. Precise. Calm. Trustworthy. No slang. No hype.

Output JSON only. No preface. Use this exact schema:
{
  "takeaway": "one clear sentence a reader can repeat",
  "facts": ["fact with a number or date", "second fact"],
  "winners": "who benefits, <= 15 words",
  "losers": "who is most exposed, <= 15 words",
  "counterpoint": "credible counterpoint, <= 25 words",
  "watch_next": "what to watch next, <= 20 words",
  "analysis": "120-180 word plain-English analysis paragraphs"
}

Rules:
1) Include at least two concrete facts with numbers or dates.
2) Be specific about daily-life effects, costs, access, eligibility, timelines.
3) If something is uncertain, say what would confirm it.
4) Keep tone calm and professional.

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
            content: 'Explain policy impacts in clear, plain language. Prioritize who benefits, who is harmed, timelines, and concrete effects. Maintain a professional, calm tone.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 380,
        temperature: 0.3
      })
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let parsed = null;
    try {
      const jsonText = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.analysis) {
      return res.json({
        impact: parsed.analysis.trim(),
        takeaway: parsed.takeaway?.trim() || null,
        facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [],
        winners: parsed.winners?.trim() || null,
        losers: parsed.losers?.trim() || null,
        counterpoint: parsed.counterpoint?.trim() || null,
        watch_next: parsed.watch_next?.trim() || null,
        source: 'real-time',
        cached: false
      });
    }

    if (raw) {
      return res.json({
        impact: raw,
        source: 'real-time',
        cached: false
      });
    }

    throw new Error('No analysis content received from OpenAI');
  } catch (error) {
    console.error('Analysis error:', error);
    const fallbackAnalysis =
      'For most people, the effect will depend on how the rule is implemented. Watch eligibility, fees, deadlines, and enforcement. Those decide who benefits and who bears the cost.';
    return res.json({
      impact: fallbackAnalysis,
      takeaway: 'Implementation details will decide who benefits and who pays.',
      facts: [],
      winners: null,
      losers: null,
      counterpoint: 'Some impacts may be smaller if agencies delay rollout.',
      watch_next: 'Agency guidance and timelines.',
      source: 'fallback',
      cached: false
    });
  }
}
