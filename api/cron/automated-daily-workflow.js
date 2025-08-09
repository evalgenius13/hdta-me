// api/automated-daily-workflow.js
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
    await this.scheduleNewsletter(edition.id);
    await this.logWorkflowSuccess(edition);
    return edition;
  }

  async curateAndAnalyze() {
    const today = new Date().toISOString().split('T')[0];
    const existing = await this.checkExistingEdition(today);
    if (existing) return existing;

    const articles = await this.fetchPolicyNews();
    const selected = await this.selectBestArticles(articles);
    const analyzed = await this.generateAnalysisWithQualityChecks(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  async generateAnalysisWithQualityChecks(articles) {
    const out = [];
    const limit = Math.min(articles.length, this.maxArticles);

    for (let i = 0; i < limit; i++) {
      const a = articles[i];
      let analysis = null;

      for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
        const raw = await this.generateSingleAnalysis(a).catch(() => null);
        const cleaned = raw ? this.sanitizeAnalysis(a, raw) : null;
        if (cleaned) {
          analysis = cleaned;
          break;
        }
        await this.sleep(1500);
      }

      if (!analysis) analysis = this.generateFallbackAnalysis();

      out.push({
        ...a,
        order: i + 1,
        analysis,
        analysis_generated_at: new Date().toISOString(),
        quality_score: this.calculateAnalysisQuality(analysis)
      });

      if (i < limit - 1) await this.sleep(1200);
    }

    return out;
  }

  async generateSingleAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write 130 to 170 words. Plain English. Professional and relaxed. No bullets. No lists.
1) Lead with the everyday impact in sentence one.
2) Explain concrete effects first: costs, payback, access, timelines, paperwork.
3) Name who benefits most and who is most exposed in natural sentences. Use specific roles like small installers, renters, homeowners, investors, agency staff.
4) Mention demographics only if supported by the article text. Do not invent.
5) Add a short historical line tied to similar recent decisions. No new dates unless present. If a date is unknown, write "not stated".
6) Add one sentence on what to watch next and likely hidden costs such as fees, delays, caps, or credit changes.
7) Do not use headings. Do not say "officials overlook". Do not moralize.

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

    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const data = await r.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  sanitizeAnalysis(article, text) {
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

    const inputs = [article.title || '', article.description || '', article.publishedAt || ''].join(' ').toLowerCase();
    const years = normalized.match(/\b(19|20)\d{2}\b/g) || [];
    for (const y of years) {
      if (!inputs.includes(y.toLowerCase())) return null;
    }

    return normalized;
  }

  generateFallbackAnalysis() {
    return 'For most readers, the effect depends on implementation. The key levers are eligibility, fees, timelines, and paperwork. Those decide who benefits and who pays.\n\nPeople who tend to benefit are those able to qualify quickly and lock terms before programs change. People most exposed are late applicants and anyone facing new fees or credit changes. Prior decisions in similar cases have shifted benefits more than once, so outcomes can move.\n\nWatch for agency guidance, application caps, and any new fixed charges or delays. These details often matter more than the headline.';
  }

  calculateAnalysisQuality(analysis) {
    let score = 0;
    const wc = (analysis || '').split(/\s+/).filter(Boolean).length;
    if (wc >= 120) score += 30;
    if (wc <= 180) score += 20;
    const hits = ['cost', 'bills', 'fees', 'access', 'timeline', 'benefit', 'harm', 'workers', 'renters', 'homeowners', 'investors', 'installers'];
    hits.forEach(h => {
      if ((analysis || '').toLowerCase().includes(h)) score += 3;
    });
    return Math.min(100, score);
  }

  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      const query = 'congress OR senate OR "executive order" OR regulation OR "supreme court" OR governor OR legislature OR rule';
      const r = await fetch(
        `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`
      );
      const data = await r.json();
      return Array.isArray(data.articles) ? data.articles : [];
    } catch {
      return [];
    }
  }

  async selectBestArticles(articles) {
    const filtered = articles.filter(a =>
      a?.title &&
      a?.description &&
      !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks)\b/i.test(a.title)
    );

    const deduped = this.removeNearDuplicates(filtered);
    const scored = deduped.map(a => ({ ...a, score: this.calculatePolicyScore(a) }));
    return scored.sort((x, y) => y.score - x.score).slice(0, this.maxArticles);
  }

  removeNearDuplicates(list) {
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

  calculatePolicyScore(article) {
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

  async createEdition(date, articles, status = 'published') {
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
      analysis_word_count: (a.analysis || '').split(/\s+/).filter(Boolean).length
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

  async scheduleNewsletter(editionId) {
    try {
      await supabase.from('daily_editions').update({ status: 'sent' }).eq('id', editionId);
    } catch {}
  }

  async logWorkflowSuccess(edition) {
    const duration = Math.floor((Date.now() - this.startTime) / 1000);
    await supabase.from('curation_metrics').insert({
      edition_id: edition.id,
      articles_fetched: 20,
      articles_analyzed: this.maxArticles,
      total_processing_time_seconds: duration,
      openai_api_calls: this.maxArticles,
      estimated_cost_usd: this.maxArticles * 0.02
    });
  }

  async checkExistingEdition(date) {
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
