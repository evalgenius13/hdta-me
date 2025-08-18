// api/cron/automated-daily-workflow.js - FIXED: News API primary, GNews fallback, inline filtering
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// --- helper: split the model output into two sections ---
function splitSections(markdown = '') {
  const txt = markdown.replace(/\r/g, '');
  const m1 = /###\s*What(?:'|’)?s Happening Here\?\s*([\s\S]*?)(?=###\s*How Does This Affect Me\?|$)/i.exec(txt);
  const m2 = /###\s*How Does This Affect Me\?\s*([\s\S]*)$/i.exec(txt);
  return {
    whats_happening: (m1?.[1] || '').trim(),
    affects_me: (m2?.[1] || '').trim()
  };
}

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

    // Fetch articles with News API primary, GNews fallback
    const articles = await this.fetchCombinedNewsWithFallback();
    console.log('🔵 fetchCombinedNews returned:', articles.length, 'articles');

    if (articles.length === 0) {
      throw new Error('No articles could be fetched from any source');
    }

    const selected = this.selectBest(articles);
    console.log('🟡 selectBest after filtering:', selected.length, 'articles');

    const analyzed = await this.analyzeAll(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  // UPDATED: News API primary with GNews fallback
  async fetchCombinedNewsWithFallback() {
    // Environment variable configuration with News API defaults
    const provider = process.env.NEWS_API_PROVIDER || 'newsapi'; // newsapi or gnews
    const newsApiKey = process.env.NEWS_API_KEY;
    const gNewsApiKey = process.env.GNEWS_API_KEY;
    
    console.log('📡 News provider configuration:', { 
      primary: provider,
      hasNewsAPI: !!newsApiKey,
      hasGNews: !!gNewsApiKey 
    });

    let primaryArticles = [];
    let secondaryArticles = [];
    let usedProvider = 'none';

    // TRY 1: News API (primary)
    if (provider === 'newsapi' && newsApiKey) {
      try {
        const newsApiResult = await this.fetchFromNewsAPI();
        primaryArticles = newsApiResult.primary || [];
        secondaryArticles = newsApiResult.secondary || [];
        usedProvider = 'newsapi';
        console.log(`✅ News API success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (error) {
        console.warn('⚠️ News API failed:', error.message);
      }
    }

    // FALLBACK: GNews API
    if (primaryArticles.length === 0 && secondaryArticles.length === 0 && gNewsApiKey) {
      console.log('🔄 Falling back to GNews API...');
      try {
        const gNewsResult = await this.fetchFromGNews();
        primaryArticles = gNewsResult.primary || [];
        secondaryArticles = gNewsResult.secondary || [];
        usedProvider = 'gnews';
        console.log(`✅ GNews fallback success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (error) {
        console.error('❌ GNews fallback also failed:', error.message);
      }
    }

    // Combine and process results
    let allArticles = [...primaryArticles, ...secondaryArticles];
    console.log(`📊 Combined from ${usedProvider}: ${allArticles.length} articles`);

    // FIXED: Inline content filtering (no method call)
    allArticles = allArticles.filter(article => 
      article?.title && 
      article?.description && 
      article?.url &&
      !article.title?.includes('[Removed]') // News API removed articles
    );
    
    console.log(`📊 Valid articles after basic filtering: ${allArticles.length}`);

    // Exclude-only keyword filter (from env)
    const excludeKeywords = process.env.NEWS_EXCLUDE_KEYWORDS 
      ? process.env.NEWS_EXCLUDE_KEYWORDS.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];
    
    console.log('🔍 Applying exclude filters only:', { excludeCount: excludeKeywords.length });

    if (excludeKeywords.length > 0) {
      const beforeFilter = allArticles.length;
      allArticles = allArticles.filter(article => {
        const text = `${article.title} ${article.description || ''}`.toLowerCase();
        for (const keyword of excludeKeywords) {
          if (text.includes(keyword)) {
            console.log(`🚫 Excluded: ${article.title.substring(0, 50)}... (contains "${keyword}")`);
            return false;
          }
        }
        return true;
      });
      console.log(`📊 After exclude filtering: ${allArticles.length} articles (removed ${beforeFilter - allArticles.length})`);
    }
    
    return allArticles;
  }

  // NEW: News API implementation with smart policy filtering
  async fetchFromNewsAPI() {
    const API_KEY = process.env.NEWS_API_KEY;
    const country = process.env.NEWS_API_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || 'en';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || '20';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || '100';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || '1000');
    
    // Smart policy filtering
    const includeQuery = process.env.NEWS_INCLUDE_QUERY || 
      'congress OR senate OR "house passes" OR "executive order" OR "supreme court" OR regulation';
    const sourcesWhitelist = process.env.NEWS_SOURCES_WHITELIST;
    const domainsWhitelist = process.env.NEWS_DOMAINS_WHITELIST;
    
    console.log('📰 News API config with policy filtering:', { country, language, maxPrimary, maxSecondary });

    let primaryArticles = [];
    let secondaryArticles = [];

    // Fetch 1: Top headlines from quality sources
    try {
      console.log(`📰 Fetching ${maxPrimary} headlines from quality sources...`);
      const primaryUrl = sourcesWhitelist
        ? `https://newsapi.org/v2/top-headlines?sources=${encodeURIComponent(sourcesWhitelist)}&pageSize=${maxPrimary}&apiKey=${API_KEY}`
        : `https://newsapi.org/v2/top-headlines?country=${country}&pageSize=${maxPrimary}&apiKey=${API_KEY}`;
      
      const primaryResponse = await fetch(primaryUrl);
      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json();
        if (primaryData.status === 'ok') {
          primaryArticles = (primaryData.articles || []).map(article => this.normalizeNewsAPIArticle(article));
          console.log(`✅ News API quality headlines: ${primaryArticles.length} articles`);
        } else {
          throw new Error(`News API error: ${primaryData.message || 'Unknown error'}`);
        }
      } else {
        throw new Error(`News API HTTP ${primaryResponse.status}: ${primaryResponse.statusText}`);
      }
    } catch (error) {
      console.warn(`⚠️ News API headlines failed: ${error.message}`);
    }

    // Small delay between API calls
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Fetch 2: Policy-targeted search
    try {
      console.log(`🔍 Searching for policy content with targeted query...`);
      const params = new URLSearchParams({
        q: includeQuery,
        language: language,
        pageSize: maxSecondary,
        sortBy: 'publishedAt'
      });
      if (domainsWhitelist) params.set('domains', domainsWhitelist);

      const searchUrl = `https://newsapi.org/v2/everything?${params.toString()}&apiKey=${API_KEY}`;
      const searchResponse = await fetch(searchUrl);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.status === 'ok') {
          secondaryArticles = (searchData.articles || []).map(article => this.normalizeNewsAPIArticle(article));
          console.log(`✅ News API policy search: ${secondaryArticles.length} articles`);
        } else {
          throw new Error(`News API search error: ${searchData.message || 'Unknown error'}`);
        }
      } else {
        throw new Error(`News API search HTTP ${searchResponse.status}: ${searchResponse.statusText}`);
      }
    } catch (error) {
      console.warn(`⚠️ News API policy search failed: ${error.message}`);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  // EXISTING: GNews implementation (kept as fallback)
  async fetchFromGNews() {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      throw new Error('GNEWS_API_KEY not found');
    }

    // Use unified config variables, fall back to GNews-specific ones for backward compatibility
    const primaryCategory = process.env.NEWS_API_PRIMARY_CATEGORY || process.env.GNEWS_PRIMARY_CATEGORY || 'general';
    const secondaryQuery = process.env.NEWS_API_SECONDARY_QUERY || process.env.GNEWS_SECONDARY_QUERY || 
      'congress OR senate OR biden OR trump OR policy OR federal OR government OR legislation';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || process.env.GNEWS_MAX_PRIMARY || '20';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || process.env.GNEWS_MAX_SECONDARY || '6';
    const country = process.env.NEWS_API_COUNTRY || process.env.GNEWS_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || process.env.GNEWS_LANGUAGE || 'en';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || process.env.GNEWS_DELAY_MS || '1000');

    console.log('📰 GNews fallback config:', { primaryCategory, maxPrimary, maxSecondary });

    let primaryArticles = [];
    let secondaryArticles = [];

    // Fetch primary category headlines
    try {
      const primaryUrl = primaryCategory === 'general' 
        ? `https://gnews.io/api/v4/top-headlines?lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`
        : `https://gnews.io/api/v4/top-headlines?category=${primaryCategory}&lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`;
      
      const primaryResponse = await fetch(primaryUrl);
      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json();
        primaryArticles = (primaryData.articles || []).map(article => this.normalizeGNewsArticle(article));
        console.log(`✅ GNews ${primaryCategory}: ${primaryArticles.length} articles`);
      }
    } catch (error) {
      console.warn(`⚠️ GNews ${primaryCategory} failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Fetch secondary content (always use search for political content)
    try {
      const searchUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(secondaryQuery)}&lang=${language}&country=${country}&max=${maxSecondary}&token=${API_KEY}`;
      const searchResponse = await fetch(searchUrl);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        secondaryArticles = (searchData.articles || []).map(article => this.normalizeGNewsArticle(article));
        console.log(`✅ GNews search: ${secondaryArticles.length} articles`);
      }
    } catch (error) {
      console.warn(`⚠️ GNews search failed: ${error.message}`);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  // NEW: Normalize News API article format to match expected structure
  normalizeNewsAPIArticle(article) {
    return {
      title: article.title,
      description: article.description,
      url: article.url,
      urlToImage: article.urlToImage,
      publishedAt: article.publishedAt,
      source: {
        name: article.source?.name || 'Unknown Source'
      }
    };
  }

  // NEW: Normalize GNews article format
  normalizeGNewsArticle(article) {
    return {
      title: article.title,
      description: article.description,
      url: article.url,
      urlToImage: article.image,
      publishedAt: article.publishedAt,
      source: {
        name: article.source?.name || 'Unknown Source'
      }
    };
  }

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
            console.log(`  📊 Generated ${raw ? raw.split(/\s+/).length : 0} words`);

            if (raw) {
              const cleaned = this.sanitize(a, raw);
              if (cleaned) {
                analysis = cleaned;
                console.log(`  ✅ Analysis accepted (${cleaned.split(/\s+/).length} words)`);
              } else {
                console.log(`  ❌ Analysis REJECTED by sanitize function`);
              }
            } else {
              console.log(`  ⚠️ No analysis generated - OpenAI returned empty`);
            }
          } catch (error) {
            console.log(`  ❌ Generation failed: ${error.message}`);
          }
          if (!analysis && attempt < this.maxRetries - 1) {
            console.log(`  🔄 Retrying in ${this.retryDelay}ms...`);
            await this.sleep(this.retryDelay);
          }
        }
        if (!analysis) {
          console.log(`  ❌ No analysis generated for article ${i + 1} - leaving empty`);
        }
      }

      const finalAnalysis = analysis || 'No analysis available';

      out.push({
        ...a,
        order: i + 1,
        analysis: finalAnalysis,
        analysis_generated_at: analysis ? new Date().toISOString() : null,
        analysis_word_count: finalAnalysis ? finalAnalysis.split(/\s+/).filter(Boolean).length : 0,
        status: shouldAnalyze ? 'published' : 'queue',
        score: a.score || 0
      });
    }
    
    console.log(`🐛 DEBUG: Returning ${out.length} articles, ${out.filter(a => a.analysis !== 'No analysis available').length} with real analysis`);
    return out;
  }

  selectBest(list) {
    console.log('🔍 Starting selection with', list.length, 'articles');
    const deduped = this.dedupe(list);
    console.log('🔍 After deduplication:', deduped.length, 'articles');
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    const final = scored
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
    console.log('🔍 Final selection:', final.length, 'articles');
    final.forEach((a, i) => {
      console.log(`  ${i + 1}. Score ${a.score}: ${a.title.substring(0, 60)}...`);
    });
    return final;
  }

  async generateHumanImpactAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const clean = (s, max) =>
      (s || '').replace(/[^\w\s\-.,!?'"]/g, '').substring(0, max);
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

    // Try in order; if you don't have access to gpt-5 your key will 404/400 and we'll fall back automatically.
    const models = ['gpt-5']; // Test GPT-5 only - remove fallbacks to see if you actually have access
    // const models = ['gpt-5', 'gpt-4o', 'gpt-4.1']; // Uncomment for production fallbacks

    const makeRequest = async (model) => {
      const body = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.4
      };

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        const msg = `OpenAI ${model} HTTP ${r.status} ${r.statusText} :: ${errText}`;
        if ([401, 403, 429].includes(r.status)) {
          throw new Error(msg);
        }
        return { ok: false, error: msg };
      }

      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return { ok: false, error: `Empty completion from ${model}` };
      }
      return { ok: true, content };
    };

    let lastErr = null;
    for (const model of models) {
      try {
        console.log(`🧠 Trying OpenAI model: ${model}`);
        const res = await makeRequest(model);
        if (res.ok) return res.content;
        console.warn(`⚠️ ${model} returned no content: ${res.error}`);
        lastErr = new Error(res.error);
      } catch (e) {
        console.warn(`⚠️ ${model} failed: ${e.message}`);
        lastErr = e;
      }
    }

    throw lastErr ?? new Error('All OpenAI model attempts failed with unknown error');
  }

  // UPDATED: allow only the two known H3 headers; still reject bullets
  sanitize(article, text) {
    const normalized = text
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n\n');

    const wc = normalized.split(/\s+/).filter(Boolean).length;
    if (wc < 120 || wc > 280) {
      console.log(`  ❌ Word count rejected: ${wc} words (need 120-280)`);
      return null;
    }

    // Reject bullet points or numbered lists
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`  ❌ Formatting rejected: bullet points/numbered lists detected`);
      return null;
    }

    // Allow ONLY these two H3 headers; reject any other headers
    const allowedHeaders = [/^### What's Happening Here\?/mi, /^### How Does This Affect Me\?/mi];
    const hasAnyHeader = /^#+\s/m.test(normalized);
    const hasAllowed = allowedHeaders.some(r => r.test(normalized));
    if (hasAnyHeader && !hasAllowed) {
      console.log(`  ❌ Formatting rejected: unexpected headers found`);
      return null;
    }

    console.log(`  ✅ Sanitize passed: ${wc} words, headers preserved if present`);
    return normalized;
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
          console.log(`    🔄 Duplicate detected: "${a.title?.substring(0, 50)}..." (${(sim * 100).toFixed(1)}% similar)`);
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
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();
    const highValue = ['executive order', 'supreme court', 'congress passes', 'senate votes', 'bill signed', 'federal ruling', 'white house', 'biden', 'trump'];
    highValue.forEach(k => { if (t.includes(k)) s += 15; });
    const mediumValue = ['congress', 'senate', 'house', 'federal', 'government', 'policy', 'legislation', 'court', 'judge', 'ruling', 'election', 'political'];
    mediumValue.forEach(k => { if (t.includes(k)) s += 8; });
    const lowValue = ['mayor', 'governor', 'local', 'state', 'business', 'economy', 'health', 'education'];
    lowValue.forEach(k => { if (t.includes(k)) s += 3; });
    const negative = ['celebrity', 'entertainment', 'sports', 'death', 'dies', 'shooting', 'crime'];
    negative.forEach(k => { if (t.includes(k)) s -= 5; });
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 8;
      else if (hrs < 12) s += 5;
      else if (hrs < 24) s += 3;
    }
    const qualitySources = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post', 'new york times', 'politico', 'cnn', 'fox news'];
    if (qualitySources.some(src => (article.source?.name || '').toLowerCase().includes(src))) s += 5;
    return Math.max(0, s);
  }

  async createEdition(date, articles, status) {
    if (!articles || articles.length === 0) {
      console.warn('⚠️ No articles to create edition with');
      throw new Error('Cannot create edition without articles');
    }
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
        console.log(`📊 Using fallback issue number: ${issue}`);
      } else {
        issue = next || 1;
      }
    } catch (error) {
      console.warn('⚠️ Issue number calculation failed, using timestamp-based number');
      issue = Math.floor(Date.now() / 86400000);
    }

    let edition;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data: editionData, error: e1 } = await supabase
          .from('daily_editions')
          .insert({
            edition_date: date,
            issue_number: issue,
            status,
            featured_headline: articles[0]?.title || 'Daily Headlines'
          })
          .select()
          .single();
        if (e1) throw e1;
        edition = editionData;
        break;
      } catch (error) {
        console.warn(`⚠️ Edition creation attempt ${attempt} failed for date ${date}, issue #${issue}:`, error.message);
        if (attempt === 3) throw error;
        await this.sleep(2000);
      }
    }

    // --- use splitSections() to store both sections alongside the full analysis_text ---
    const rows = articles.map(a => {
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
        // NEW fields:
        whats_happening: whats_happening || null,
        affects_me: affects_me || null
      };
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
        if (e2) throw e2;
        break;
      } catch (error) {
        console.warn(`⚠️ Articles insert attempt ${attempt} failed for edition ${edition.id} with ${rows.length} articles:`, error.message);
        if (attempt === 3) {
          await supabase.from('daily_editions').delete().eq('id', edition.id);
          throw error;
        }
        await this.sleep(2000);
      }
    }

    console.log(`✅ Created edition #${issue} with ${articles.length} articles`);
    console.log(`📊 Breakdown: ${articles.filter(a => a.status === 'published').length} published, ${articles.filter(a => a.status === 'queue').length} queued`);
    return edition;
  }

  async publishToWebsite(editionId) {
    try {
      const { error } = await supabase
        .from('daily_editions')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', editionId);
      if (error) throw error;
      console.log('✅ Edition published to website');
    } catch (error) {
      console.error('❌ publishToWebsite failed:', error.message);
      throw error;
    }
  }

  async markNewsletterSent(editionId) {
    try {
      const { error } = await supabase
        .from('daily_editions')
        .update({ status: 'sent' })
        .eq('id', editionId);
      if (error) {
        console.warn('⚠️ Failed to mark newsletter as sent:', error.message);
      } else {
        console.log('✅ Newsletter marked as sent');
      }
    } catch (error) {
      console.warn('⚠️ markNewsletterSent error:', error.message);
    }
  }

  async findEdition(date) {
    try {
      const { data, error } = await supabase
        .from('daily_editions')
        .select('*')
        .eq('edition_date', date)
        .single();
      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }
      const { data: articles } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', data.id)
        .limit(1);
      if (!articles || articles.length === 0) {
        console.log('🗑️ Found empty edition, will recreate');
        await supabase.from('daily_editions').delete().eq('id', data.id);
        return null;
      }
      return data;
    } catch (error) {
      console.error('❌ findEdition failed:', error.message);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
