// api/cron/automated-daily-workflow.js - FIXED: GPT-4.1 compatible, News API primary, GNews fallback, inline filtering
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

    // FIXED: Inline content filtering with policy scoring
    
    // Filter invalid articles
    allArticles = allArticles.filter(article => 
      article?.title && 
      article?.description && 
      article?.url &&
      !article.title?.includes('[Removed]') // News API removed articles
    );
    
    console.log(`📊 Valid articles after basic filtering: ${allArticles.length}`);

    // Get exclude keywords only
    const excludeKeywords = process.env.NEWS_EXCLUDE_KEYWORDS 
      ? process.env.NEWS_EXCLUDE_KEYWORDS.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];
    
    console.log('🔍 Applying exclude filters and policy scoring:', { excludeCount: excludeKeywords.length });

    if (excludeKeywords.length > 0) {
      const beforeFilter = allArticles.length;
      
      allArticles = allArticles.filter(article => {
        const text = `${article.title} ${article.description || ''}`.toLowerCase();
        
        // Exclude articles with banned keywords
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

    // Add policy scoring and keep top articles
    allArticles = allArticles
      .map(a => ({ ...a, policyScore: this.policyScore(a) }))
      .sort((a, b) => b.policyScore - a.policyScore)
      .slice(0, this.maxArticles); // Keep only what we'll actually use (26 articles)

    console.log(`📊 After policy scoring: ${allArticles.length} articles (top policy-relevant)`);
    
    return allArticles;
  }

  // NEW: News API implementation with smart policy filtering
  async fetchFromNewsAPI() {
    const API_KEY = process.env.NEWS_API_KEY;
    const country = process.env.NEWS_API_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || 'en';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || '20';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || '30';
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
        ? `https://newsapi.org/v2/top-headlines?sources=${encodeURIComponent(sourcesWhitelist)}&pageSize=${maxPrimary}`
        : `https://newsapi.org/v2/top-headlines?country=${country}&pageSize=${maxPrimary}`;
      
      const primaryResponse = await fetch(primaryUrl, {
        headers: { 'X-Api-Key': API_KEY }
      });
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

    // Fetch 2: Policy-targeted search with freshness window
    try {
      console.log(`🔍 Searching for policy content with targeted query...`);
      
      // Add 36-hour freshness window
      const fromISO = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      
      const params = new URLSearchParams({
        q: includeQuery,
        language: language,
        pageSize: maxSecondary,
        sortBy: 'publishedAt',
        from: fromISO
      });
      
      // Trim domains list to avoid URL length limits
      if (domainsWhitelist) {
        const trimmedDomains = domainsWhitelist.split(',').slice(0, 30).join(',');
        params.set('domains', trimmedDomains);
      }
      
      const searchUrl = `https://newsapi.org/v2/everything?${params.toString()}`;
      
      const searchResponse = await fetch(searchUrl, {
        headers: { 'X-Api-Key': API_KEY }
      });
      
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

  // NEW: Policy scoring function
  policyScore(article) {
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();

    // High-value policy terms
    const highValue = [
      'executive order', 'supreme court', 'house passes', 'senate votes',
      'bill signed', 'federal judge', 'appeals court', 'rulemaking', 'proposed rule',
      'final rule', 'regulation', 'white house', 'ballot measure'
    ];
    
    // Government agencies
    const agencies = ['ftc', 'fcc', 'epa', 'hhs', 'cms', 'doj', 'dol', 'irs', 'hud', 'dot', 'doe'];
    
    // Civic terms
    const civics = ['congress', 'senate', 'house', 'governor', 'statehouse', 'attorney general'];

    let s = 0;
    highValue.forEach(k => { if (t.includes(k)) s += 12; });
    agencies.forEach(k => { if (t.includes(k)) s += 8; });
    civics.forEach(k => { if (t.includes(k)) s += 6; });

    // Quality source bonus
    const src = (article.source?.name || '').toLowerCase();
    const qualitySources = [
      'reuters', 'ap', 'politico', 'axios', 'bloomberg', 'washington post', 
      'new york times', 'wall street journal', 'npr', 'the hill', 'propublica', 
      'ft', 'roll call', 'stat'
    ];
    if (qualitySources.some(q => src.includes(q))) s += 5;

    // Freshness bonus
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 5; 
      else if (hrs < 24) s += 3;
    }

    // Penalty for non-policy content
    const negative = ['nba', 'nfl', 'mlb', 'soccer', 'celebrity', 'royal family', 'oscars', 'grammys'];
    negative.forEach(k => { if (t.includes(k)) s -= 10; });

    return Math.max(0, s);
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

  // FIXED: generateHumanImpactAnalysis method - Admin API compatible with GPT-4.1
  async generateHumanImpactAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

    // Check for prompt environment variables early
    const systemPrompt = process.env.SYSTEM_PROMPT;
    const userTemplate = process.env.USER_PROMPT;
    if (!systemPrompt || !userTemplate) throw new Error('SYSTEM_PROMPT and USER_PROMPT must be set');

    // Clean article data
    const clean = (s, max) => (s || '').replace(/[^\w\s\-.,!?'"]/g, '').substring(0, max);
    
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';
    const title = clean(article.title, 200);
    const desc = clean(article.description, 400);
    const src = clean(source, 80);

    const prompt = userTemplate
      .replace('{title}', title)
      .replace('{description}', desc)
      .replace('{source}', src)
      .replace('{date}', pubDate);

    console.log(`🧠 Calling GPT-4.1 for "${title.substring(0, 50)}..."`);

    const body = {
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.4,
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${OPENAI_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenAI GPT-4.1 HTTP ${response.status} ${response.statusText} :: ${errorText}`);
    }

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error('Empty completion from GPT-4.1');
    }

    // Post-processing guards (matching admin API expectations)
    const banned = /^(in|at|on|inside|across)\b/i;
    if (banned.test(content)) {
      content = content.replace(banned, '').replace(/^[\s,–—-]+/, '').replace(/^[a-z]/, c => c.toUpperCase());
    }

    console.log(`✅ GPT-4.1 generated ${content.length} characters`);
    return content;
  }

  // FIXED: sanitize method for admin API compatibility
  sanitize(article, text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    let normalized = text
      .replace(/\r/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n\n');

    const words = normalized.split(/\s+/).filter(Boolean);
    
    // Check minimum length
    if (words.length < 20) {
      console.log(`  ❌ Too short: ${words.length} words`);
      return null;
    }
    
    // Trim if too long
    if (words.length > 280) {
      normalized = words.slice(0, 220).join(' ');
      console.log(`  ✂️ Trimmed from ${words.length} to 220 words`);
    }
    
    // Reject bullet points/lists
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`  ❌ Contains bullet points/lists`);
      return null;
    }

    // Check for basic sentence structure
    const sentences = normalized.split(/[.!?]+/).filter(s => s.trim().length > 10);
    if (sentences.length < 2) {
      console.log(`  ❌ Not enough sentences`);
      return null;
    }

    const finalWordCount = normalized.split(/\s+/).filter(Boolean).length;
    console.log(`  ✅ Clean: ${finalWordCount} words`);
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
    // Original scoring logic
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
    
    // Policy-first weighting
    return this.policyScore(article) * 2 + Math.max(0, s);
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

    const rows = articles.map(a => ({
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
      article_score: a.score
    }));

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

// Export the class and workflow function
export { AutomatedPublisher };

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
