// api/cron/automated-daily-workflow.js - SIMPLE FIXED VERSION
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 20;
    this.numAnalyzed = 6;
    this.maxRetries = 3;
    this.retryDelay = 1500;
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
    console.log('Fetched:', articles.length, 'articles');

    const selected = await this.selectBest(articles);
    console.log('Selected:', selected.length, 'articles');

    const analyzed = await this.analyzeAll(selected);
    return await this.createEdition(today, analyzed, 'published');
  }

  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      if (!API_KEY) {
        console.error('Missing GNEWS_API_KEY');
        return [];
      }

      const url = `https://gnews.io/api/v4/top-headlines?category=politics&lang=en&country=us&max=50&token=${API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('GNews error:', response.status);
        return [];
      }

      const data = await response.json();
      const articles = Array.isArray(data.articles) ? data.articles : [];
      
      // Simple filter - just remove obvious non-policy content
      return articles.filter(article => {
        if (!article?.title || !article?.description) return false;
        const content = (article.title + ' ' + article.description).toLowerCase();
        const excludeKeywords = ['nfl', 'nba', 'mlb', 'sports scores'];
        return !excludeKeywords.some(keyword => content.includes(keyword));
      });
      
    } catch (error) {
      console.error('Failed to fetch news:', error);
      return [];
    }
  }

  async selectBest(list) {
    // Remove duplicates and score
    const deduped = this.dedupe(list);
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    return scored
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
  }

  async analyzeAll(articles) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;
      const shouldAnalyze = i < this.numAnalyzed;

      if (shouldAnalyze) {
        console.log(`Analyzing article ${i + 1}: ${a.title?.substring(0, 60)}...`);
        for (let attempt = 0; attempt < this.maxRetries && !analysis; attempt++) {
          const raw = await this.generateNarrative(a).catch(() => null);
          const cleaned = raw ? this.sanitize(a, raw) : null;
          if (cleaned) analysis = cleaned;
          if (!analysis) await this.sleep(this.retryDelay);
        }
        if (!analysis) analysis = this.fallback();
      }

      // FIXED: Always provide analysis_text (never null)
      const finalAnalysis = analysis || 'Analysis pending for this article.';

      out.push({
        ...a,
        order: i + 1,
        analysis: finalAnalysis,
        analysis_generated_at: analysis ? new Date().toISOString() : null,
        analysis_word_count: finalAnalysis.split(/\s+/).filter(Boolean).length,
        status: shouldAnalyze ? 'published' : 'queue',
        score: a.score || 0
      });
    }
    return out;
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
        featured_headline: articles?.[0]?.title || 'Policy Updates'
      })
      .select()
      .single();
    if (e1) throw e1;

    if (articles && articles.length > 0) {
      const rows = articles.map(a => ({
        edition_id: edition.id,
        article_order: a.order,
        title: a.title,
        description: a.description,
        url: a.url,
        image_url: a.urlToImage || a.image,
        source_name: a.source?.name,
        published_at: a.publishedAt || new Date().toISOString(),
        analysis_text: a.analysis,
        analysis_generated_at: a.analysis_generated_at,
        analysis_word_count: a.analysis_word_count,
        article_status: a.status,
        article_score: a.score
      }));

      const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
      if (e2) throw e2;

      console.log(`Created edition #${issue} with ${articles.length} articles`);
    }

    return edition;
  }

  dedupe(list) {
    const seen = [];
    const out = [];
    for (const a of list) {
      const norm = (a.title || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      let dup = false;
      for (const s of seen) {
        if (this.jaccard(norm, s) > 0.75) {
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
    return uni.size === 0 ? 0 : inter.size / uni.size;
  }

  score(article) {
    let s = 0;
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();
    
    ['congress', 'senate', 'federal', 'supreme court', 'white house'].forEach(k => {
      if (t.includes(k)) s += 10;
    });
    
    ['government', 'policy', 'law', 'election', 'political'].forEach(k => {
      if (t.includes(k)) s += 5;
    });
    
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 12) s += 5;
    }
    
    return Math.max(0, s);
  }

  sanitize(article, text) {
    if (!text) return null;
    const normalized = text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n\n');
    const wc = normalized.split(/\s+/).filter(Boolean).length;
    if (wc < 100 || wc > 250) return null;
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) return null;
    return normalized;
  }

  fallback() {
    return 'The real impact depends on implementation details still being negotiated. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

  async generateNarrative(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
    
    const prompt = `Write exactly 140-170 words explaining how this policy affects people:

Policy: "${article.title}"
Details: "${article.description}"

Focus on:
1. Real impact people will feel
2. Timeline and implementation details  
3. Who benefits and who gets hurt
4. What to watch for next`;

    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You explain policy in terms of real human impact. Be specific and credible.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 280,
          temperature: 0.4
        })
      });

      if (!r.ok) throw new Error(`OpenAI API ${r.status}`);
      const data = await r.json();
      return data.choices?.[0]?.message?.content?.trim();
    } catch (error) {
      console.error('OpenAI failed:', error.message);
      throw error;
    }
  }

  async publishToWebsite(editionId) {
    const { error } = await supabase
      .from('daily_editions')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', editionId);
    if (error) throw error;
  }

  async markNewsletterSent(editionId) {
    await supabase
      .from('daily_editions')
      .update({ status: 'sent' })
      .eq('id', editionId);
  }

  async findEdition(date) {
    const { data, error } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', date)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
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
