// api/personalize.js
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
        impact: normalizeParagraphs(article.preGeneratedAnalysis),
        source: 'automated',
        cached: true
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write 130 to 170 words. Plain English. Professional and relaxed. No bullets. No lists.
1) Lead with the everyday impact in sentence one. Example: "If you are X, this means Y."
2) Explain concrete effects first: costs, payback, access, timelines, paperwork.
3) Name who benefits most and who is most exposed in natural sentences. Use specific roles like small installers, renters, homeowners, investors, agency staff.
4) Mention demographics only if supported by the article or well documented patterns in the text provided. Do not invent.
5) Add one sentence of short historical context tied to similar recent decisions. No new dates unless present in inputs. If a date is unknown, write "not stated".
6) Add one sentence on what to watch next and any likely hidden costs such as fees, delays, cap limits, or credit changes.
7) Do not use headings. Do not moralize. Do not say "officials overlook".

Policy: "${article.title}"
Details: "${article.description}"
PublishedAt: "${pubDate}"
Source: "${source}"
`.trim();

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: 'You translate policy news into concrete personal impact. You are concise, specific, and careful not to invent numbers or dates.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 260,
        temperature: 0.3
      })
    });

    if (!r.ok) throw new Error(`OpenAI API ${r.status}`);
    const data = await r.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const impact = sanitizeNarrative(article, raw) || fallbackNarrative();

    return res.json({
      impact,
      source: 'real-time',
      cached: false
    });
  } catch (e) {
    return res.json({
      impact: fallbackNarrative(),
      source: 'fallback',
      cached: false
    });
  }
}

function normalizeParagraphs(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

function sanitizeNarrative(article, text) {
  if (!text) return null;
  const normalized = normalizeParagraphs(text);

  const wc = normalized.split(/\s+/).filter(Boolean).length;
  if (wc < 110 || wc > 220) return null;

  // Disallow headings or lists
  if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) return null;

  // Disallow unfounded dates
  const inputs = [article.title || '', article.description || '', article.publishedAt || ''].join(' ').toLowerCase();
  const years = normalized.match(/\b(19|20)\d{2}\b/g) || [];
  for (const y of years) {
    if (!inputs.includes(y.toLowerCase())) return null;
  }

  return normalized;
}

function fallbackNarrative() {
  return normalizeParagraphs(
    'For most readers, the effect depends on how the rule is implemented. The key levers are eligibility, fees, timelines, and paperwork. Those decide who benefits and who pays.\n\nPeople who tend to benefit are those able to qualify quickly and lock terms before programs change. People most exposed are late applicants and anyone facing new fees or credit changes. Prior decisions in similar cases have shifted benefits more than once, so outcomes can move.\n\nWatch for agency guidance, application caps, and any new fixed charges or delays. These quiet details often matter more than the headline.'
  );
}
