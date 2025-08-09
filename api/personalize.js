export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Always avoid CDN/browser caching for this endpoint
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { article } = req.body || {};
    if (!article?.title || !article?.description) {
      return res.status(400).json({ error: 'Missing article data' });
    }

    // Allow client to force regeneration
    const forceRefresh = Boolean(article.forceRefresh) || req.query?.refresh === '1';

    // If not forcing, honor any pre-generated analysis in the feed
    if (!forceRefresh && article.preGeneratedAnalysis) {
      return res.json({
        impact: String(article.preGeneratedAnalysis).trim(),
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
3) Do not invent dates, percentages, or dollar amounts not present in "Details". If unknown, write "date not announced" or "magnitude unclear".
4) If a claim is uncertain, state what would confirm it.
5) Keep tone calm and professional.

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
            content: 'Explain policy impacts in clear, plain language. Prioritize who benefits, who is harmed, timelines, and concrete effects. Maintain a professional, calm tone. Never fabricate numbers or dates.'
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

    // Try JSON parse, stripping common code fences
    let parsed = null;
    try {
      const jsonText = raw.replace(/^\s*```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(jsonText);
    } catch {}

    if (parsed && parsed.analysis) {
      return res.json({
        impact: String(parsed.analysis).trim(),
        takeaway: parsed.takeaway?.trim() || null,
        facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [],
        winners: parsed.winners?.trim() || null,
        losers: parsed.losers?.trim() || null,
        counterpoint: parsed.counterpoint?.trim() || null,
        watch_next: parsed.watch_next?.trim() || null,
        source: forceRefresh ? 'forced' : 'real-time',
        cached: false
      });
    }

    // Fallback to whatever text we got
    if (raw) {
      return res.json({
        impact: raw,
        source: forceRefresh ? 'forced' : 'real-time',
        cached: false
      });
    }

    throw new Error('No analysis content received from OpenAI');
  } catch (error) {
    console.error('Analysis error:', error);
    const fallbackAnalysis =
      'For most people, the effect depends on implementation. Watch eligibility, fees, deadlines, and enforcement. Those decide who benefits and who bears the cost.';
    return res.json({
      impact: fallbackAnalysis,
      takeaway: 'Implementation details will decide who benefits and who pays.',
      facts: [],
      winners: null,
      losers: null,
      counterpoint: 'Impacts may be smaller if rollout is delayed.',
      watch_next: 'Agency guidance and timelines.',
      source: 'fallback',
      cached: false
    });
  }
}
