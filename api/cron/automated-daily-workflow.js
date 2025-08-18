// api/cron/automated-daily-workflow.js
// Daily workflow: NewsAPI (primary) + GNews (fallback), policy-first scoring, GPT analysis, DB write.
// Exposes both a callable function AND an HTTP handler for Vercel Cron.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---- Utility: tiny sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 26;
    this.numAnalyzed = 6;
    this.maxRetries = 3;
    this.retryDelay = 1500;
    this.startTime = Date.now();
  }

  async runFullWorkflow() {
    console.log('🚀 Starting daily workflow...');
    const edition = await this.curateAndAnalyze();
    await this.publishToWebsite(edition.id);
    await this.markNewsletterSent(edition.id);
    console.log('✅ Daily workflow completed');
    return edition;
  }

  async curateAndAnalyze() {
    const today = new Date().toISOString().split('T')[0];
    const existing = await this.findEdition(today);
    if (existing) {
      console.log(`📰 Edition already exists for ${today}, returning existing`);
      return existing;
    }

    const articles = await this.fetchCombinedNewsWithFallback();
    console.log('🔵 fetchCombinedNews returned:', articles.length, 'articles');
    if (articles.length === 0) throw new Error('No articles could be fetched from any source');

    const selected = this.selectBest(articles);
    console.log('🟡 selectBest after filtering:', selected.length, 'articles');

    const analyzed = await this.analyzeAll(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  // ---------------------------
  // Fetchers + filtering
  // ---------------------------
  async fetchCombinedNewsWithFallback() {
    const provider = process.env.NEWS_API_PROVIDER || 'newsapi'; // 'newsapi' or 'gnews'
    const hasNews = !!process.env.NEWS_API_KEY;
    const hasGNews = !!process.env.GNEWS_API_KEY;

    console.log('📡 News provider configuration:', { primary: provider, hasNewsAPI: hasNews, hasGNews });

    let primaryArticles = [];
    let secondaryArticles = [];
    let usedProvider = 'none';

    if (provider === 'newsapi' && hasNews) {
      try {
        const res = await this.fetchFromNewsAPI();
        primaryArticles = res.primary || [];
        secondaryArticles = res.secondary || [];
        usedProvider = 'newsapi';
        console.log(`✅ News API success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (e) {
        console.warn('⚠️ News API failed:', e.message);
      }
    }

    if (primaryArticles.length === 0 && secondaryArticles.length === 0 && hasGNews) {
      console.log('🔄 Falling back to GNews API...');
      try {
        const g = await this.fetchFromGNews();
        primaryArticles = g.primary || [];
        secondaryArticles = g.secondary || [];
        usedProvider = 'gnews';
        console.log(`✅ GNews fallback success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (e) {
        console.error('❌ GNews fallback also failed:', e.message);
      }
    }

    let allArticles = [...primaryArticles, ...secondaryArticles];
    console.log(`📊 Combined from ${usedProvider}: ${allArticles.length} articles`);

    // Basic validity
    allArticles = allArticles.filter(
      (a) => a?.title && a?.description && a?.url && !a.title.includes('[Removed]')
    );
    console.log(`📊 Valid articles after basic filtering: ${allArticles.length}`);

    // Exclude list (env provides comma-separated keywords)
    const excludeKeywords = (process.env.NEWS_EXCLUDE_KEYWORDS || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (excludeKeywords.length) {
      const before = allArticles.length;
      allArticles = allArticles.filter((a) => {
        const text = `${a.title} ${a.description || ''}`.toLowerCase();
        return !excludeKeywords.some((kw) => text.includes(kw));
      });
      console.log(`📊 After exclude filtering: ${allArticles.length} (removed ${before - allArticles.length})`);
    }

    // Policy-first prefilter, cap to keep downstream fast
    allArticles = allArticles
      .map((a) => ({ ...a, policyScore: this.policyScore(a) }))
      .sort((x, y) => y.policyScore - x.policyScore)
      .slice(0, 120);

    console.log(`📊 After policy scoring: ${allArticles.length} (top policy-relevant)`);
    return allArticles;
  }

  async fetchFromNewsAPI() {
    const API_KEY = process.env.NEWS_API_KEY;
    const country = process.env.NEWS_API_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || 'en';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || '20';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || '30';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || '1000', 10);

    const includeQuery =
      process.env.NEWS_INCLUDE_QUERY ||
      'congress OR senate OR "house passes" OR "executive order" OR "supreme court" OR regulation';
    const sourcesWhitelist = process.env.NEWS_SOURCES_WHITELIST; // NewsAPI *source IDs*
    const domainsWhitelist = process.env.NEWS_DOMAINS_WHITELIST; // plain domains
    let primaryArticles = [];
    let secondaryArticles = [];

    try {
      console.log(`📰 Fetching ${maxPrimary} headlines from quality sources...`);
      const primaryUrl = sourcesWhitelist
        ? `https://newsapi.org/v2/top-headlines?sources=${encodeURIComponent(
            sourcesWhitelist
          )}&pageSize=${maxPrimary}`
        : `https://newsapi.org/v2/top-headlines?country=${country}&pageSize=${maxPrimary}`;

      const resp = await fetch(primaryUrl, { headers: { 'X-Api-Key': API_KEY } });
      if (!resp.ok) throw new Error(`NewsAPI HTTP ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      if (data.status !== 'ok') throw new Error(`NewsAPI error: ${data.message || 'Unknown'}`);
      primaryArticles = (data.articles || []).map((a) => this.normalizeNewsAPIArticle(a));
    } catch (e) {
      console.warn('⚠️ News API headlines failed:', e.message);
    }

    await sleep(delayMs);

    try {
      console.log('🔍 Searching for policy content (36h freshness)...');
      const fromISO = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams({
        q: includeQuery,
        language,
        pageSize: maxSecondary,
        sortBy: 'publishedAt',
        from: fromISO,
      });
      if (domainsWhitelist) {
        params.set('domains', domainsWhitelist.split(',').slice(0, 30).join(','));
      }
      const searchUrl = `https://newsapi.org/v2/everything?${params.toString()}`;
      const r = await fetch(searchUrl, { headers: { 'X-Api-Key': API_KEY } });
      if (!r.ok) throw new Error(`NewsAPI search HTTP ${r.status} ${r.statusText}`);
      const d = await r.json();
      if (d.status !== 'ok') throw new Error(`NewsAPI search error: ${d.message || 'Unknown'}`);
      secondaryArticles = (d.articles || []).map((a) => this.normalizeNewsAPIArticle(a));
    } catch (e) {
      console.warn('⚠️ News API policy search failed:', e.message);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  async fetchFromGNews() {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) throw new Error('GNEWS_API_KEY not found');

    const primaryCategory =
      process.env.NEWS_API_PRIMARY_CATEGORY || process.env.GNEWS_PRIMARY_CATEGORY || 'general';
    const secondaryQuery =
      process.env.NEWS_API_SECONDARY_QUERY ||
      process.env.GNEWS_SECONDARY_QUERY ||
      'congress OR senate OR biden OR trump OR policy OR federal OR government OR legislation';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || process.env.GNEWS_MAX_PRIMARY || '20';
    const maxSecondary =
      process.env.NEWS_API_MAX_SECONDARY || process.env.GNEWS_MAX_SECONDARY || '6';
    const country = process.env.NEWS_API_COUNTRY || process.env.GNEWS_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || process.env.GNEWS_LANGUAGE || 'en';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || process.env.GNEWS_DELAY_MS || '1000', 10);

    let primaryArticles = [];
    let secondaryArticles = [];

    try {
      const primaryUrl =
        primaryCategory === 'general'
          ? `https://gnews.io/api/v4/top-headlines?lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`
          : `https://gnews.io/api/v4/top-headlines?category=${primaryCategory}&lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`;

      const r = await fetch(primaryUrl);
      if (r.ok) {
        const d = await r.json();
        primaryArticles = (d.articles || []).map((a) => this.normalizeGNewsArticle(a));
      }
    } catch (e) {
      console.warn(`⚠️ GNews ${primaryCategory} failed:`, e.message);
    }

    await sleep(delayMs);

    try {
      const searchUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
        secondaryQuery
      )}&lang=${language}&country=${country}&max=${maxSecondary}&token=${API_KEY}`;
      const r = await fetch(searchUrl);
      if (r.ok) {
        const d = await r.json();
        secondaryArticles = (d.articles || []).map((a) => this.normalizeGNewsArticle(a));
      }
    } catch (e) {
      console.warn('⚠️ GNews search failed:', e.message);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  // ---------------------------
  // Normalizers
  // ---------------------------
  normalizeNewsAPIArticle(a) {
    return {
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.urlToImage,
      publishedAt: a.publishedAt,
      source: { name: a.source?.name || 'Unknown Source' },
    };
  }
  normalizeGNewsArticle(a) {
    return {
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image,
      publishedAt: a.publishedAt,
      source: { name: a.source?.name || 'Unknown Source' },
    };
  }

  // ---------------------------
  // Analysis
  // ---------------------------
  async analyzeAll(articles) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;
      const shouldAnalyze = i < this.numAnalyzed;

      if (shouldAnalyze) {
        console.log(`🔬 Analyzing article ${i + 1}: ${a.title?.substring(0, 60)}...`);
        for (let attempt = 0; attempt < this.maxRetries && !analysis; attempt++) {
          try {
            console.log(`  📝 Generation attempt ${attempt + 1}...`);
            const raw = await this.generateHumanImpactAnalysis(a);
            if (raw) {
              const cleaned = this.sanitize(raw);
              if (cleaned) analysis = cleaned;
              else console.log('  ❌ Analysis REJECTED by sanitize');
            } else {
              console.log('  ⚠️ OpenAI returned empty content');
            }
          } catch (e) {
            console.log(`  ❌ Generation failed: ${e.message}`);
          }
          if (!analysis && attempt < this.maxRetries - 1) {
            console.log(`  🔄 Retrying in ${this.retryDelay}ms...`);
            await sleep(this.retryDelay);
          }
        }
      }

      const finalAnalysis = analysis || 'No analysis available';
      out.push({
        ...a,
        order: i + 1,
        analysis: finalAnalysis,
        analysis_generated_at: analysis ? new Date().toISOString() : null,
        analysis_word_count: finalAnalysis.split(/\s+/).filter(Boolean).length,
        status: shouldAnalyze ? 'published' : 'queue',
        score: a.score || 0,
      });
    }
    console.log(
      `🐛 DEBUG: Returning ${out.length} articles, ${
        out.filter((a) => a.analysis !== 'No analysis available').length
      } with real analysis`
    );
    return out;
  }

  async generateHumanImpactAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY environment variable is not set');

    const clean = (s, max) => (s || '').replace(/[^\w\s\-.,!?'"]/g, '').substring(0, max);
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';
    const cleanTitle = clean(article.title, 200);
    const cleanDescription = clean(article.description, 500);
    const cleanSource = clean(source, 80);

    const systemPrompt = process.env.SYSTEM_PROMPT;
    const userPromptTemplate = process.env.USER_PROMPT;
    if (!systemPrompt || !userPromptTemplate) {
      throw new Error('SYSTEM_PROMPT and USER_PROMPT environment variables must be set');
    }

    const prompt = userPromptTemplate
      .replace('{title}', cleanTitle)
      .replace('{description}', cleanDescription)
      .replace('{source}', cleanSource)
      .replace('{date}', pubDate);

    const models = ['gpt-5', 'gpt-4o', 'gpt-4.1'];

    const hitModel = async (model) => {
      const body = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.4,
      };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        const msg = `OpenAI ${model} HTTP ${r.status} ${r.statusText} :: ${txt}`;
        if ([401, 403, 429].includes(r.status)) throw new Error(msg); // bubble up
        return { ok: false, error: msg };
      }
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) return { ok: false, error: `Empty completion from ${model}` };
      return { ok: true, content };
    };

    let lastErr = null;
    for (const m of models) {
      try {
        console.log(`🧠 Trying OpenAI model: ${m}`);
        const res = await hitModel(m);
        if (res.ok) return res.content;
        lastErr = new Error(res.error);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('All OpenAI model attempts failed');
  }

  sanitize(text) {
    const normalized = text
      .replace(/\r/g, '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');

    const wc = normalized.split(/\s+/).filter(Boolean).length;
    if (wc < 120 || wc > 280) return null;
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) return null;

    // If you require specific H3 sections, uncomment and enforce the two headers:
    // const allowed = [/^### What's Happening Here\?/mi, /^### How Does This Affect Me\?/mi];
    // const hasHeaders = /^#+\s/m.test(normalized);
    // if (hasHeaders && !allowed.some((r) => r.test(normalized))) return null;

    return normalized;
  }

  // ---------------------------
  // Ranking & helpers
  // ---------------------------
  policyScore(article) {
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();
    const highValue = [
      'executive order',
      'supreme court',
      'house passes',
      'senate votes',
      'bill signed',
      'federal judge',
      'appeals court',
      'rulemaking',
      'proposed rule',
      'final rule',
      'regulation',
      'white house',
      'ballot measure',
    ];
    const agencies = ['ftc', 'fcc', 'epa', 'hhs', 'cms', 'doj', 'dol', 'irs', 'hud', 'dot', 'doe'];
    const civics = ['congress', 'senate', 'house', 'governor', 'statehouse', 'attorney general'];
    let s = 0;
    highValue.forEach((k) => t.includes(k) && (s += 12));
    agencies.forEach((k) => t.includes(k) && (s += 8));
    civics.forEach((k) => t.includes(k) && (s += 6));

    const src = (article.source?.name || '').toLowerCase();
    const qualitySources = [
      'reuters',
      'ap',
      'politico',
      'axios',
      'bloomberg',
      'washington post',
      'new york times',
      'wall street journal',
      'npr',
      'the hill',
      'propublica',
      'ft',
      'roll call',
      'stat',
    ];
    if (qualitySources.some((q) => src.includes(q))) s += 5;

    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 5;
      else if (hrs < 24) s += 3;
    }

    const negative = ['nba', 'nfl', 'mlb', 'soccer', 'celebrity', 'royal family', 'oscars', 'grammys'];
    negative.forEach((k) => t.includes(k) && (s -= 10));
    return Math.max(0, s);
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
        if (sim > 0.75) {
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
    const wa = new Set(a.split(' ').filter((w) => w.length > 2));
    const wb = new Set(b.split(' ').filter((w) => w.length > 2));
    const inter = new Set([...wa].filter((w) => wb.has(w)));
    const uni = new Set([...wa, ...wb]);
    return uni.size ? inter.size / uni.size : 0;
  }

  score(article) {
    let s = 0;
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();
    const highValue = [
      'executive order',
      'supreme court',
      'congress passes',
      'senate votes',
      'bill signed',
      'federal ruling',
      'white house',
      'biden',
      'trump',
    ];
    const mediumValue = [
      'congress',
      'senate',
      'house',
      'federal',
      'government',
      'policy',
      'legislation',
      'court',
      'judge',
      'ruling',
      'election',
      'political',
    ];
    const lowValue = [
      'mayor',
      'governor',
      'local',
      'state',
      'business',
      'economy',
      'health',
      'education',
    ];
    const negative = ['celebrity', 'entertainment', 'sports', 'death', 'dies', 'shooting', 'crime'];

    highValue.forEach((k) => t.includes(k) && (s += 15));
    mediumValue.forEach((k) => t.includes(k) && (s += 8));
    lowValue.forEach((k) => t.includes(k) && (s += 3));
    negative.forEach((k) => t.includes(k) && (s -= 5));

    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 8;
      else if (hrs < 12) s += 5;
      else if (hrs < 24) s += 3;
    }

    const qualitySources = [
      'reuters',
      'ap news',
      'bloomberg',
      'wall street journal',
      'washington post',
      'new york times',
      'politico',
      'cnn',
      'fox news',
    ];
    if (qualitySources.some((src) => (article.source?.name || '').toLowerCase().includes(src))) s += 5;

    // policy-first weighting
    return this.policyScore(article) * 2 + Math.max(0, s);
  }

  // ---------------------------
  // DB
  // ---------------------------
  async createEdition(date, articles, status) {
    if (!articles?.length) throw new Error('Cannot create edition without articles');

    let issue = 1;
    try {
      const { data: next, error } = await supabase.rpc('get_next_issue_number');
      if (error) {
        console.warn('⚠️ get_next_issue_number failed:', error.message);
        const { data: maxIssue } = await supabase
          .from('daily_editions')
          .select('issue_number')
          .order('issue_number', { ascending: false })
          .limit(1)
          .single();
        issue = (maxIssue?.issue_number || 0) + 1;
      } else {
        issue = next || 1;
      }
    } catch {
      issue = Math.floor(Date.now() / 86400000);
    }

    let edition;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data, error } = await supabase
          .from('daily_editions')
          .insert({
            edition_date: date,
            issue_number: issue,
            status,
            featured_headline: articles[0]?.title || 'Daily Headlines',
          })
          .select()
          .single();
        if (error) throw error;
        edition = data;
        break;
      } catch (e) {
        console.warn(`⚠️ Edition creation attempt ${attempt} failed:`, e.message);
        if (attempt === 3) throw e;
        await sleep(2000);
      }
    }

    // Optional: split sections if your prompt uses H3 headers.
    const splitSections = (markdown) => {
      const txt = (markdown || '').replace(/\r/g, '');
      const m1 = /###\s*What(?:'|’)?s Happening Here\?\s*([\s\S]*?)(?=###\s*How Does This Affect Me\?|$)/i.exec(
        txt
      );
      const m2 = /###\s*How Does This Affect Me\?\s*([\s\S]*)$/i.exec(txt);
      return { whats_happening: (m1?.[1] || '').trim(), affects_me: (m2?.[1] || '').trim() };
    };

    const rows = articles.map((a) => {
      const { whats_happening, affects_me } = splitSections(a.analysis);
      return {
        edition_id: edition.id,
        article_order: a.order,
        title: a.title,
        description: a.description,
        url: a.url,
        image_url: a.urlToImage || a.image,
        source_name: a.source?.name || 'Unknown Source',
        published_at: a.publishedAt || new Date().toISOString(),
        analysis_text: a.analysis,
        analysis_generated_at: a.analysis_generated_at,
        analysis_word_count: a.analysis_word_count,
        article_status: a.status,
        article_score: a.score,
        // if your table has these nullable columns, they'll be saved:
        whats_happening: whats_happening || null,
        affects_me: affects_me || null,
      };
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error } = await supabase.from('analyzed_articles').insert(rows);
        if (error) throw error;
        break;
      } catch (e) {
        console.warn(
          `⚠️ Articles insert attempt ${attempt} failed for edition ${edition.id}:`,
          e.message
        );
        if (attempt === 3) {
          await supabase.from('daily_editions').delete().eq('id', edition.id);
          throw e;
        }
        await sleep(2000);
      }
    }

    console.log(
      `✅ Created edition #${issue} with ${articles.length} articles (published: ${
        articles.filter((a) => a.status === 'published').length
      }, queued: ${articles.filter((a) => a.status === 'queue').length})`
    );
    return edition;
  }

  async publishToWebsite(editionId) {
    const { error } = await supabase
      .from('daily_editions')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', editionId);
    if (error) throw error;
    console.log('✅ Edition published to website');
  }

  async markNewsletterSent(editionId) {
    const { error } = await supabase
      .from('daily_editions')
      .update({ status: 'sent' })
      .eq('id', editionId);
    if (error) console.warn('⚠️ Failed to mark newsletter as sent:', error.message);
    else console.log('✅ Newsletter marked as sent');
  }

  async findEdition(date) {
    try {
      const { data, error } = await supabase
        .from('daily_editions')
        .select('*')
        .eq('edition_date', date)
        .single();
      if (error) {
        if (error.code === 'PGRST116') return null; // not found
        throw error;
      }
      const { data: articles } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', data.id)
        .limit(1);
      if (!articles?.length) {
        console.log('🗑️ Found empty edition, will recreate');
        await supabase.from('daily_editions').delete().eq('id', data.id);
        return null;
      }
      return data;
    } catch (e) {
      console.error('❌ findEdition failed:', e.message);
      throw e;
    }
  }
}

// export for programmatic use (optional)
export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}

// default HTTP handler for Vercel Cron (GET/POST)
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const edition = await runAutomatedWorkflow();
    return res.json({ ok: true, edition_id: edition.id, date: edition.edition_date });
  } catch (e) {
    console.error('❌ Cron run failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
