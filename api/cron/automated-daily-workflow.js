// api/cron/automated-daily-workflow.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 6;
    this.startTime = Date.now();
  }

  async runFullWorkflow() {
    const edition = await this.curateAndAnalyze();
    await this.publishToWebsite(edition.id);
    await this.markNewsletterSent(edition.id);
    return edition;
  }

  async curateAndAnalyze() {
    const today = new Date().toISOString().split('T')[0];
    const existing = await this.findEdition(today);
    if (existing) return existing;

    const articles = await this.fetchPolicyNews();
    // Debug: How many articles raw from GNews
    console.log('🔵 fetchPolicyNews returned:', articles.length, 'articles');
    const selected = await this.selectBest(articles);
    // Debug: How many after filtering
    console.log('🟡 selectBest after filtering:', selected.length, 'articles');
    const analyzed = await this.analyzeAll(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  async analyzeAll(articles) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;

      for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
        const raw = await this.generateNarrative(a).catch(() => null);
        const cleaned = raw ? this.sanitize(a, raw) : null;
        if (cleaned) analysis = cleaned;
        if (!analysis) await this.sleep(1200);
      }

      if (!analysis) analysis = this.fallback();

      out.push({
        ...a,
        order: i + 1,
        analysis,
        analysis_generated_at: new Date().toISOString(),
        analysis_word_count: analysis.split(/\s+/).filter(Boolean).length
      });
    }
    return out;
  }

  async generateNarrative(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write exactly 140-170 words as a compelling insider analysis that reveals what's really happening. Use plain English but show deep policy knowledge.

Paragraph 1 - REAL IMPACT (30-40 words): Start with the concrete consequence people will actually feel. Be specific: "Your mortgage rate jumps 0.3%" not "rates may change." Think like someone who's seen this playbook before.

Paragraph 2 - THE MECHANICS (40-50 words): Explain HOW this works in practice. Include specific timelines, dollar amounts, eligibility thresholds. What's the implementation reality vs. the press release version?

Paragraph 3 - WINNERS & LOSERS (40-50 words): Name who actually benefits and who gets hurt. Be specific about industries, regions, demographics when the data supports it. Don't be vague - if community banks struggle while big banks thrive, say so directly.

Paragraph 4 - INSIDER PERSPECTIVE (25-35 words): What's not being said publicly? Historical precedent? Hidden timelines? Real motivations? End with what to watch for next that signals the true impact.

Use concrete language:
- "implementation" → "when it starts"
- "stakeholders" → specific groups affected
- "regulatory framework" → "new rules"
- "may impact" → "will cost" or "will benefit"

Policy: "${article.title}"
Details: "${article.description}"
Source: "${source}"
Date: "${pubDate}"
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
          { role: 'system', content: 'You are a seasoned policy insider who explains complex regulations in terms of real human impact. Be specific, credible, and revealing about how policy actually works. Avoid jargon but show deep expertise.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 280,
        temperature: 0.4
      })
    });

    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const data = await r.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  sanitize(article, text) {
    if (!text) return null;
    const normalized = text
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n\n');

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

  fallback() {
    return 'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

  // UPDATED: Fetch articles from the last 3 days, and log all titles for debugging
  async fetchPolicyNews() {
  try {
    const API_KEY = process.env.GNEWS_API_KEY;
    const query = 'congress OR senate OR "executive order" OR regulation OR "supreme court"';

    // Use a 2-day rolling window for recency (adjust as you like, or remove for no date filter)
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - 2);
    const fromStr = fromDate.toISOString().split('T')[0];
    const toStr = today.toISOString().split('T')[0];

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&from=${fromStr}&to=${toStr}&token=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    // Debug: log the full response object
    console.log('GNews API full response:', JSON.stringify(data, null, 2));

    // Defensive: GNews sometimes uses publishedAt, sometimes published_at
    const articles = Array.isArray(data.articles) ? data.articles : [];
    console.log(`Fetched ${articles.length} articles from GNews`);
    articles.forEach((a, i) => {
      if (a && a.title) console.log(`Article ${i + 1}: ${a.title}`);
    });

    return articles;
  } catch (error) {
    console.error('Failed to fetch news:', error);
    return [];
  }
}
  async selectBest(list) {
    const filtered = list.filter(
      a =>
        a?.title &&
        a?.description
        // Comment out exclusion temporarily to observe
        // && !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks)\b/i.test(a.title)
    );
    console.log('After filtering:', filtered.length);
    const deduped = this.dedupe(filtered);
    console.log('After dedupe:', deduped.length);
    return deduped
      .map(a => ({ ...a, score: this.score(a) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
  }

  dedupe(list) {
    const seen = [];
    const out = [];
    for (const a of list) {
      const norm = (a.title || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      let dup = false;
      for (const s of seen) {
        const sim = this.jaccard(norm, s);
        if (sim > 0.82) {
          dup = true;
          break;
        }
      }
      if (!dup) {
        seen.push(norm);
        out.push(a);
      }
    }
    return out;
  }

  jaccard(a, b) {
    const wa = new Set(a.split(' ').filter(w => w.length > 2));
    const wb = new Set(b.split(' ').filter(w => w.length > 2));
    const inter = new Set([...wa].filter(w => wb.has(w)));
    const uni = new Set([...wa, ...wb]);
    if (uni.size === 0) return 0;
    return inter.size / uni.size;
  }

  score(article) {
    let s = 0;
    const t = (article.title + ' ' + article.description).toLowerCase();
    ['executive order', 'supreme court', 'federal', 'regulation', 'congress passes', 'senate votes', 'bill signed', 'new rule'].forEach(k => {
      if (t.includes(k)) s += 10;
    });
    ['policy', 'law', 'court', 'judge', 'ruling', 'decision', 'congress', 'senate', 'house', 'governor', 'legislature'].forEach(k => {
      if (t.includes(k)) s += 5;
    });
    ['golf', 'sports', 'celebrity', 'entertainment', 'music', 'movie'].forEach(k => {
      if (t.includes(k)) s -= 15;
    });
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 24) s += 5;
      if (hrs < 12) s += 3;
    }
    const qs = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post', 'los angeles times'];
    if (qs.some(src => article.source?.name?.toLowerCase().includes(src))) s += 3;
    return Math.max(0, s);
  }

  async createEdition(date, articles, status) {
    const { data: next } = await supabase.rpc('get_next_issue_number');
    const issue = next || 1;

    const { data: edition, error: e1 } = await supabase
      .from('daily_editions')
      .insert({
        edition_date: date,
        issue_number: issue,
        status,
        featured_headline: articles[0]?.title || 'Policy Updates'
      })
      .select()
      .single();
    if (e1) throw e1;

    const rows = articles.map(a => ({
      edition_id: edition.id,
      article_order: a.order,
      title: a.title,
      description: a.description,
      url: a.url,
      image_url: a.urlToImage || a.image,
      source_name: a.source?.name,
      published_at: a.publishedAt,
      analysis_text: a.analysis,
      analysis_generated_at: a.analysis_generated_at,
      analysis_word_count: a.analysis_word_count
    }));

    const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
    if (e2) throw e2;

    return edition;
  }

  async publishToWebsite(editionId) {
    const { error } = await supabase
      .from('daily_editions')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', editionId);
    if (error) throw error;
  }

  async markNewsletterSent(editionId) {
    try {
      await supabase.from('daily_editions').update({ status: 'sent' }).eq('id', editionId);
    } catch {}
  }

  async findEdition(date) {
    const { data, error } = await supabase.from('daily_editions').select('*').eq('edition_date', date).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
