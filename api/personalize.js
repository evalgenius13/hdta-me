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

    // Use pre-generated when present
    if (article.preGeneratedAnalysis) {
      const impact = applyEthics(normalizeParagraphs(article.preGeneratedAnalysis));
      return res.json({ impact, source: 'automated', cached: true });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Service unavailable' });

    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write 130 to 170 words. Plain English. Professional and relaxed. No bullets. No lists.
1) Lead with the everyday impact in sentence one.
2) Explain concrete effects first: costs, payback, access, timelines, paperwork.
3) Name who benefits most and who is most exposed in natural sentences. Use specific roles like small installers, renters, homeowners, investors, agency staff.
4) Mention demographics only if supported by the article text. Do not invent.
5) If an effect advantages one group by reducing fairness, access, or representation for another, do not call it a benefit. State it neutrally as an effect with its consequences.
6) Add a short historical line tied to similar recent decisions. No new dates unless present. If a date is unknown, write "not stated".
7) Add one sentence on what to watch next and likely hidden costs such as fees, delays, caps, or credit changes.
8) Do not use headings. Do not say "officials overlook". Do not moralize.

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
            content: 'Translate policy news into concrete personal impact. Be concise and specific. Do not invent numbers or dates.'
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

    const cleaned = sanitizeNarrative(article, raw);
    const impact = applyEthics(cleaned || fallbackNarrative());

    return res.json({ impact, source: cleaned ? 'real-time' : 'fallback', cached: false });
  } catch (e) {
    return res.json({ impact: fallbackNarrative(), source: 'fallback', cached: false });
  }
}

// Strict content normalization
function normalizeParagraphs(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

// Validates length, blocks lists/headings, blocks invented years
function sanitizeNarrative(article, text) {
  if (!text) return null;
  const normalized = normalizeParagraphs(text);

  const wc = normalized.split(/\s+/).filter(Boolean).length;
  if (wc < 110 || wc > 220) return null;

  if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) return null;

  const inputs = [article.title || '', article.description || '', article.publishedAt || '']
    .join(' ')
    .toLowerCase();
  const years = normalized.match(/\b(19|20)\d{2}\b/g) || [];
  for (const y of years) {
    if (!inputs.includes(String(y).toLowerCase())) return null;
  }

  return normalized;
}

// Post-process to avoid labeling unethical advantages as "benefits"
function applyEthics(text) {
  let out = text;

  const sensitivePhrases = [
    'less diversity',
    'reduced diversity',
    'more homogenous',
    'less representation',
    'exclusion',
    'discrimin',
    'disparate impact',
    'voter suppression',
    'gerrymander',
    'redlined',
    'segregat'
  ];

  // If a sentence contains a benefit word and sensitive cue, reframe "benefit" to "effect"
  out = out
    .split(/\n\n/)
    .map(par => {
      const sentences = par.split(/(?<=[.!?])\s+/);
      const fixed = sentences.map(s => {
        const hasBenefitWord = /\b(benefit|benefits|benefited|winners?)\b/i.test(s);
        const hasSensitive = sensitivePhrases.some(k => s.toLowerCase().includes(k));
        if (hasBenefitWord && hasSensitive) {
          return s
            .replace(/\b[Bb]enefit(?:s|ed)?\b/g, 'effect')
            .replace(/\bWinners?\b/g, 'Groups most advantaged by this change');
        }
        return s;
      });
      return fixed.join(' ');
    })
    .join('\n\n');

  return out;
}

function fallbackNarrative() {
  return normalizeParagraphs(
    'For most readers, the impact depends on how the rule is implemented. Costs, eligibility, timelines, and paperwork decide who benefits and who pays.\n\nPeople who move early and qualify cleanly tend to fare better. Those facing new fees or credit changes are more exposed. Similar decisions have shifted terms before, so outcomes can move.\n\nWatch agency guidance, caps, fixed charges, and processing delays. These details often matter more than the headline.'
  );
}
