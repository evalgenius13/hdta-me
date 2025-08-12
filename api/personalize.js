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
      const impact = normalizeParagraphs(article.preGeneratedAnalysis);
      return res.json({ impact, source: 'automated', cached: true });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Service unavailable' });

    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write 130 to 170 words as a compelling insider analysis that reveals what's really happening. Plain English but deep policy knowledge.

1) IMMEDIATE IMPACT: Lead with the concrete consequence people will feel. Be specific - "Your student loan payment drops $150/month" not "payments may change." Think like someone who's seen this before.

2) THE REAL MECHANICS: How does this actually work? Include specific timelines, dollar amounts, eligibility details. What's the implementation reality vs. the press release spin?

3) WINNERS & LOSERS: Who actually benefits and who gets hurt? Be direct about specific industries, regions, or groups when the evidence supports it. If big companies win while small ones struggle, say so clearly.

4) INSIDER PERSPECTIVE: What's not being emphasized publicly? Historical context? Hidden timelines? Watch for what details that signal the true long-term impact.

Replace policy-speak with plain language:
- "implementation" → "when it starts"
- "stakeholders" → specific affected groups  
- "may impact" → "will cost" or "will benefit"
- "regulatory framework" → "new rules"

Be specific, not hedge-y. Show you understand how policy actually translates to real life.

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
            content: 'You are a seasoned policy insider who explains complex regulations in terms of real human impact. Be specific, credible, and revealing about how policy actually works in practice. Avoid euphemisms and jargon while maintaining credibility.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 280,
        temperature: 0.4
      })
    });

    if (!r.ok) throw new Error(`OpenAI API ${r.status}`);
    const data = await r.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();

    const cleaned = sanitizeNarrative(article, raw);
    const impact = cleaned || fallbackNarrative();

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

function fallbackNarrative() {
  return normalizeParagraphs(
    'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.'
  );
}
