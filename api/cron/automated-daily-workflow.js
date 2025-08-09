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

        if (cleaned && this.isAnalysisGoodQuality(cleaned)) {
          analysis = cleaned;
          break;
        }

        await this.sleep(1500);
      }

      if (!analysis) analysis = this.generateFallbackAnalysis(a);

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
    const pubDate = article.publishedAt || '';
    const sourceName = article.source?.name || '';

    const prompt = `
Write 120 to 160 words. Plain English. Professional and relaxed. No bullets. No lists.
Show real life effects first.
Name who benefits and who loses in natural sentences.
Add one sentence of historical context.
Add one sentence on what is not being said or hidden costs.
Mention demographics only if the article or well documented patterns support it.
Use only dates and numbers present in Policy, Details, or PublishedAt. If unknown, write "not stated".

Policy: "${article.title}"
Details: "${article.description}"
PublishedAt: "${pubDate}"
Source: "${sourceName}"
`.trim();

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You explain policy impacts for everyday people. You are precise, calm, and specific. You never invent numbers or dates.'
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
    if (wc < 110 || wc > 200) return null;

    const inputs = [article.title || '', article.description || '', article.publishedAt || '']
      .join(' ')
      .toLowerCase();

    const yearMatches = normalized.match(/\b(19|20)\d{2}\b/g) || [];
    for (const y of yearMatches) {
      if (!inputs.includes(y.toLowerCase())) return null;
    }

    const monthRegex = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t)?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
    if (monthRegex.test(normalized) && !monthRegex.test(inputs)) return null;

    if (/- |\* |\d+\.\s/.test(normalized)) return null;

    return normalized;
  }

  isAnalysisGoodQuality(analysis) {
    if (!analysis || typeof analysis !== 'string') return false;

    const wc = analysis.split(/\s+/).filter(Boolean).length;
    if (wc < 110 || wc > 200) return false;

    const lower = analysis.toLowerCase();

    const needs = ['cost', 'bill', 'price', 'deadline', 'access', 'eligib', 'savings', 'fees', 'timeline'];
    const groups = ['homeowner', 'renter', 'small business', 'worker', 'investor', 'utility', 'official', 'regulator', 'student'];

    if (!needs.some(n => lower.includes(n))) return false;
    if (!groups.some(g => lower.includes(g))) return false;

    const bad = ['i cannot', 'i\'m sorry', 'as an ai', 'i don\'t have access', 'analysis not available', 'unable to analyze'];
    if (bad.some(b => lower.includes(b))) return false;

    return true;
  }

  generateFallbackAnalysis() {
    return 'The practical effect depends on implementation. Watch eligibility, fees, deadlines, and enforcement. Those decide who benefits and who pays. Regulators may revisit terms; changes often arrive in guidance rather than headlines.';
  }

  calculateAnalysisQuality(analysis) {
    let score = 0;
    const wc = (analysis || '').split(/\s+/).filter(Boolean).length;
    if (wc >= 120) score += 30;
    if (wc <= 180) score += 20;

    const hits = ['cost', 'bills', 'fees', 'access', 'timeline', 'benefit', 'harm', 'workers', 'renters', 'homeowners', 'investors'];
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
      return data.articles || [];
    } catch {
      return [];
    }
  }

  async selectBestArticles(articles) {
    const scored = articles.map(a => ({ ...a, score: this.calculatePolicyScore(a) }));
    return scored.sort((a, b) => b.score - a.score).slice(0, this.maxArticles);
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
    } catch {
      /* no-op */
    }
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
