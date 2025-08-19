// api/cron/automated-weekly-workflow.js - OPTIMIZED weekly workflow
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedWeeklyPublisher {
  constructor() {
    this.maxArticles = 75; // Larger pool for weekly curation
    this.numAnalyzed = 10; // Final curated selection
    this.maxRetries = 3;
    this.retryDelay = 1500;
    this.startTime = Date.now();
    this.apiRequestCount = 0; // Track API usage
  }

  async runFullWorkflow() {
    console.log('🚀 Starting weekly workflow...');
    const edition = await this.curateAndAnalyze();
    await this.publishToWebsite(edition.id);
    await this.markNewsletterSent(edition.id);
    console.log('✅ Weekly workflow completed');
    return edition;
  }

  async curateAndAnalyze() {
    const weekStart = this.getWeekStart();
    const existing = await this.findEdition(weekStart);
    if (existing) {
      console.log(`📰 Edition already exists for week ${weekStart}, returning existing`);
      return existing;
    }

    // Fetch articles for the past week
    const articles = await this.fetchWeeklyNewsWithTrends();
    console.log('🔵 fetchWeeklyNews returned:', articles.length, 'articles');

    if (articles.length === 0) {
      throw new Error('No articles could be fetched from any source');
    }

    const selected = this.selectBest(articles);
    console.log('🟡 selectBest after filtering:', selected.length, 'articles');

    // Generate trend context for this week
    const trendContext = await this.generateWeeklyTrends();
    
    const analyzed = await this.analyzeAllWithTrends(selected, trendContext);
    const edition = await this.createEdition(weekStart, analyzed, 'published');
    return edition;
  }

  // ✅ FIXED: Standardized UTC-based week calculation
  getWeekStart() {
    const now = new Date();
    
    // Use UTC to avoid timezone issues
    const utc = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));
    
    const dayOfWeek = utc.getUTCDay();
    const daysFromMonday = (dayOfWeek + 6) % 7; // Convert Sunday=0 to Monday=0 system
    
    // Calculate Monday of this week
    const monday = new Date(utc);
    monday.setUTCDate(utc.getUTCDate() - daysFromMonday);
    
    return monday.toISOString().split('T')[0];
  }

  // Enhanced news fetching for weekly timeframe
  async fetchWeeklyNewsWithTrends() {
    const provider = process.env.NEWS_API_PROVIDER || 'newsapi';
    const newsApiKey = process.env.NEWS_API_KEY;
    const gNewsApiKey = process.env.GNEWS_API_KEY;
    
    console.log('📡 Weekly news provider configuration:', { 
      primary: provider,
      hasNewsAPI: !!newsApiKey,
      hasGNews: !!gNewsApiKey 
    });

    let primaryArticles = [];
    let secondaryArticles = [];
    let usedProvider = 'none';

    // Try News API first (with 7-day window)
    if (provider === 'newsapi' && newsApiKey) {
      try {
        const newsApiResult = await this.fetchWeeklyFromNewsAPI();
        primaryArticles = newsApiResult.primary || [];
        secondaryArticles = newsApiResult.secondary || [];
        usedProvider = 'newsapi';
        console.log(`✅ News API weekly success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (error) {
        console.warn('⚠️ News API failed:', error.message);
      }
    }

    // Fallback to GNews
    if (primaryArticles.length === 0 && secondaryArticles.length === 0 && gNewsApiKey) {
      console.log('🔄 Falling back to GNews API...');
      try {
        const gNewsResult = await this.fetchWeeklyFromGNews();
        primaryArticles = gNewsResult.primary || [];
        secondaryArticles = gNewsResult.secondary || [];
        usedProvider = 'gnews';
        console.log(`✅ GNews weekly fallback success: ${primaryArticles.length} + ${secondaryArticles.length} articles`);
      } catch (error) {
        console.error('❌ GNews fallback also failed:', error.message);
      }
    }

    let allArticles = [...primaryArticles, ...secondaryArticles];
    console.log(`📊 Combined weekly articles from ${usedProvider}: ${allArticles.length}`);

    // Store trend data from fetched articles
    await this.storeTrendData(allArticles);

    // Apply filtering (same as before but for weekly volume)
    allArticles = this.filterAndScoreArticles(allArticles);
    
    return allArticles;
  }

  async fetchWeeklyFromNewsAPI() {
    const API_KEY = process.env.NEWS_API_KEY;
    const country = process.env.NEWS_API_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || 'en';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || '30';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || '50';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || '1000');
    
    // 7-day window for weekly collection
    const fromISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const includeQuery = process.env.NEWS_INCLUDE_QUERY || 
      'congress OR senate OR "house passes" OR "executive order" OR "supreme court" OR regulation';
    const sourcesWhitelist = process.env.NEWS_SOURCES_WHITELIST;
    const domainsWhitelist = process.env.NEWS_DOMAINS_WHITELIST;
    
    console.log('📰 News API weekly config:', { country, language, maxPrimary, maxSecondary, fromDate: fromISO });

    let primaryArticles = [];
    let secondaryArticles = [];

    // Fetch 1: Top headlines from past week
    try {
      console.log(`📰 Fetching ${maxPrimary} headlines from past week...`);
      
      const params = new URLSearchParams({
        country: country,
        pageSize: maxPrimary,
        from: fromISO
      });

      if (sourcesWhitelist) {
        params.delete('country');
        params.set('sources', sourcesWhitelist);
      }
      
      const primaryUrl = `https://newsapi.org/v2/top-headlines?${params.toString()}`;
      
      const primaryResponse = await fetch(primaryUrl, {
        headers: { 'X-Api-Key': API_KEY }
      });
      this.apiRequestCount++;
      
      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json();
        
        if (primaryData.status === 'ok') {
          primaryArticles = (primaryData.articles || []).map(article => this.normalizeNewsAPIArticle(article));
          console.log(`✅ News API weekly headlines: ${primaryArticles.length} articles`);
        } else {
          throw new Error(`News API error: ${primaryData.message || 'Unknown error'}`);
        }
      } else {
        throw new Error(`News API HTTP ${primaryResponse.status}: ${primaryResponse.statusText}`);
      }
    } catch (error) {
      console.warn(`⚠️ News API headlines failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Fetch 2: Policy-targeted search for the week
    try {
      console.log(`🔍 Searching weekly policy content...`);
      
      const params = new URLSearchParams({
        q: includeQuery,
        language: language,
        pageSize: maxSecondary,
        sortBy: 'publishedAt',
        from: fromISO
      });
      
      if (domainsWhitelist) {
        const trimmedDomains = domainsWhitelist.split(',').slice(0, 30).join(',');
        params.set('domains', trimmedDomains);
      }
      
      const searchUrl = `https://newsapi.org/v2/everything?${params.toString()}`;
      
      const searchResponse = await fetch(searchUrl, {
        headers: { 'X-Api-Key': API_KEY }
      });
      this.apiRequestCount++;
      
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        
        if (searchData.status === 'ok') {
          secondaryArticles = (searchData.articles || []).map(article => this.normalizeNewsAPIArticle(article));
          console.log(`✅ News API weekly policy search: ${secondaryArticles.length} articles`);
        } else {
          throw new Error(`News API search error: ${searchData.message || 'Unknown error'}`);
        }
      } else {
        throw new Error(`News API search HTTP ${searchResponse.status}: ${searchResponse.statusText}`);
      }
    } catch (error) {
      console.warn(`⚠️ News API weekly policy search failed: ${error.message}`);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  async fetchWeeklyFromGNews() {
    const API_KEY = process.env.GNEWS_API_KEY;
    const primaryCategory = process.env.NEWS_API_PRIMARY_CATEGORY || 'general';
    const secondaryQuery = process.env.NEWS_API_SECONDARY_QUERY || 
      'congress OR senate OR biden OR trump OR policy OR federal OR government OR legislation';
    const maxPrimary = process.env.NEWS_API_MAX_PRIMARY || '30';
    const maxSecondary = process.env.NEWS_API_MAX_SECONDARY || '50';
    const country = process.env.NEWS_API_COUNTRY || 'us';
    const language = process.env.NEWS_API_LANGUAGE || 'en';
    const delayMs = parseInt(process.env.NEWS_API_DELAY_MS || '1000');

    console.log('📰 GNews weekly config:', { primaryCategory, maxPrimary, maxSecondary });

    let primaryArticles = [];
    let secondaryArticles = [];

    // Fetch primary category headlines from past week
    try {
      const primaryUrl = primaryCategory === 'general' 
        ? `https://gnews.io/api/v4/top-headlines?lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`
        : `https://gnews.io/api/v4/top-headlines?category=${primaryCategory}&lang=${language}&country=${country}&max=${maxPrimary}&token=${API_KEY}`;
      
      const primaryResponse = await fetch(primaryUrl);
      if (primaryResponse.ok) {
        const primaryData = await primaryResponse.json();
        primaryArticles = (primaryData.articles || []).map(article => this.normalizeGNewsArticle(article));
        console.log(`✅ GNews weekly ${primaryCategory}: ${primaryArticles.length} articles`);
      }
    } catch (error) {
      console.warn(`⚠️ GNews weekly ${primaryCategory} failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Fetch secondary content
    try {
      const searchUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(secondaryQuery)}&lang=${language}&country=${country}&max=${maxSecondary}&token=${API_KEY}`;
      const searchResponse = await fetch(searchUrl);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        secondaryArticles = (searchData.articles || []).map(article => this.normalizeGNewsArticle(article));
        console.log(`✅ GNews weekly search: ${secondaryArticles.length} articles`);
      }
    } catch (error) {
      console.warn(`⚠️ GNews weekly search failed: ${error.message}`);
    }

    return { primary: primaryArticles, secondary: secondaryArticles };
  }

  // Store trend data from fetched articles
  async storeTrendData(articles) {
    if (!articles || articles.length === 0) {
      console.log('📊 No articles to store for trends');
      return;
    }

    try {
      const trendData = articles.map(article => ({
        headline: article.title || '',
        description: article.description || '',
        source: article.source?.name || 'Unknown',
        published_date: article.publishedAt || new Date().toISOString(),
        keywords: this.extractKeywords(article.title + ' ' + (article.description || ''))
      })).filter(item => item.headline); // Only store items with headlines

      if (trendData.length === 0) {
        console.log('📊 No valid trend data to store');
        return;
      }

      const { error } = await supabase
        .from('news_trends')
        .insert(trendData);

      if (error) {
        console.warn('⚠️ Failed to store trend data:', error.message);
      } else {
        console.log(`📊 Stored ${trendData.length} trend data points`);
      }

      // Cleanup old trend data (keep 14 days)
      const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('news_trends')
        .delete()
        .lt('published_date', cutoffDate);

    } catch (error) {
      console.warn('⚠️ Trend data storage failed:', error.message);
      // Don't throw - trend analysis is optional
    }
  }

  // Simple keyword extraction
  extractKeywords(text) {
    if (!text) return '';
    
    // Simple keyword extraction - remove common words and get important terms
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'will', 'would', 'could', 'should']);
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word))
      .slice(0, 10); // Top 10 keywords
    
    return words.join(',');
  }

  // Generate weekly trend context
  async generateWeeklyTrends() {
    try {
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: trendData, error } = await supabase
        .from('news_trends')
        .select('*')
        .gte('published_date', weekStart)
        .order('published_date', { ascending: false });

      if (error) {
        console.warn('⚠️ Failed to fetch trend data:', error.message);
        return '';
      }

      if (!trendData || trendData.length === 0) {
        return '';
      }

      // Simple trend analysis - count keyword frequency
      const keywordCounts = {};
      trendData.forEach(item => {
        if (item.keywords) {
          item.keywords.split(',').forEach(keyword => {
            keyword = keyword.trim();
            if (keyword) {
              keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
            }
          });
        }
      });

      // Get top trending keywords
      const topKeywords = Object.entries(keywordCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .filter(([keyword, count]) => count >= 3) // Must appear at least 3 times
        .map(([keyword, count]) => `${keyword} (${count})`);

      if (topKeywords.length === 0) {
        return '';
      }

      const trendContext = `This week's trending topics: ${topKeywords.join(', ')}`;
      console.log('📊 Generated trend context:', trendContext);
      
      return trendContext;
    } catch (error) {
      console.warn('⚠️ Trend analysis failed:', error.message);
      return '';
    }
  }

  filterAndScoreArticles(allArticles) {
    // Filter invalid articles
    allArticles = allArticles.filter(article => 
      article?.title && 
      article?.description && 
      article?.url &&
      !article.title?.includes('[Removed]')
    );
    
    console.log(`📊 Valid articles after basic filtering: ${allArticles.length}`);

    // Apply exclude keywords
    const excludeKeywords = process.env.NEWS_EXCLUDE_KEYWORDS 
      ? process.env.NEWS_EXCLUDE_KEYWORDS.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];
    
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

    // Add policy scoring and keep top articles
    allArticles = allArticles
      .map(a => ({ ...a, policyScore: this.policyScore(a) }))
      .sort((a, b) => b.policyScore - a.policyScore)
      .slice(0, this.maxArticles);

    console.log(`📊 After weekly policy scoring: ${allArticles.length} articles`);
    
    return allArticles;
  }

  // Enhanced scoring for weekly - less time decay penalty
  policyScore(article) {
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();

    const highValue = [
      'executive order', 'supreme court', 'house passes', 'senate votes',
      'bill signed', 'federal judge', 'appeals court', 'rulemaking', 'proposed rule',
      'final rule', 'regulation', 'white house', 'ballot measure'
    ];
    
    const agencies = ['ftc', 'fcc', 'epa', 'hhs', 'cms', 'doj', 'dol', 'irs', 'hud', 'dot', 'doe'];
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

    // Reduced freshness penalty for weekly
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 24) s += 5; 
      else if (hrs < 72) s += 3; // 3 days still good for weekly
      else if (hrs < 168) s += 1; // 1 week is acceptable
    }

    // Penalty for non-policy content
    const negative = ['nba', 'nfl', 'mlb', 'soccer', 'celebrity', 'royal family', 'oscars', 'grammys'];
    negative.forEach(k => { if (t.includes(k)) s -= 10; });

    return Math.max(0, s);
  }

  async analyzeAllWithTrends(articles, trendContext) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;
      const shouldAnalyze = i < this.numAnalyzed;

      if (shouldAnalyze) {
        console.log(`🔬 Analyzing weekly article ${i + 1}: ${a.title?.substring(0, 60)}...`);
        for (let attempt = 0; attempt < this.maxRetries && !analysis; attempt++) {
          try {
            console.log(`  📝 Generation attempt ${attempt + 1}...`);
            const raw = await this.generateHumanImpactAnalysisWithTrends(a, trendContext);
            console.log(`  📊 Generated ${raw ? raw.split(/\s+/).length : 0} words`);

            if (raw) {
              const cleaned = this.sanitize(a, raw);
              if (cleaned) {
                analysis = cleaned;
                console.log(`  ✅ Weekly analysis accepted (${cleaned.split(/\s+/).length} words)`);
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
          console.log(`  ❌ No analysis generated for weekly article ${i + 1} - leaving empty`);
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
    
    console.log(`🐛 DEBUG: Returning ${out.length} weekly articles, ${out.filter(a => a.analysis !== 'No analysis available').length} with real analysis`);
    return out;
  }

  // Enhanced analysis generation with trend context
  async generateHumanImpactAnalysisWithTrends(article, trendContext) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

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

    // Enhanced prompt with trend context
    let prompt = userTemplate
      .replace('{title}', title)
      .replace('{description}', desc)
      .replace('{source}', src)
      .replace('{date}', pubDate);

    // Add trend context if available
    if (trendContext) {
      prompt += `\n\nWeekly Context: ${trendContext}. Consider how this story relates to the week's trending topics.`;
    }

    console.log(`🧠 Calling GPT-4.1 for weekly analysis: "${title.substring(0, 50)}..."`);

    const body = {
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 350, // Slightly more for weekly context
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

    // Post-processing guards
    const banned = /^(in|at|on|inside|across)\b/i;
    if (banned.test(content)) {
      content = content.replace(banned, '').replace(/^[\s,–—-]+/, '').replace(/^[a-z]/, c => c.toUpperCase());
    }

    console.log(`✅ GPT-4.1 weekly analysis generated ${content.length} characters`);
    return content;
  }

  // Rest of the methods remain the same but with weekly terminology
  selectBest(list) {
    console.log('🔍 Starting weekly selection with', list.length, 'articles');
    const deduped = this.dedupe(list);
    console.log('🔍 After deduplication:', deduped.length, 'articles');
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    const final = scored
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
    console.log('🔍 Final weekly selection:', final.length, 'articles');
    final.forEach((a, i) => {
      console.log(`  ${i + 1}. Score ${a.score}: ${a.title.substring(0, 60)}...`);
    });
    return final;
  }

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
    
    if (words.length < 20) {
      console.log(`  ❌ Too short: ${words.length} words`);
      return null;
    }
    
    if (words.length > 300) { // Slightly higher for weekly
      normalized = words.slice(0, 250).join(' ');
      console.log(`  ✂️ Trimmed from ${words.length} to 250 words`);
    }
    
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`  ❌ Contains bullet points/lists`);
      return null;
    }

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
    
    // Weekly freshness scoring (less penalty for older articles)
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 24) s += 8;
      else if (hrs < 72) s += 5; // 3 days still good
      else if (hrs < 168) s += 3; // 1 week acceptable
    }
    
    const qualitySources = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post', 'new york times', 'politico', 'cnn', 'fox news'];
    if (qualitySources.some(src => (article.source?.name || '').toLowerCase().includes(src))) s += 5;
    
    return this.policyScore(article) * 2 + Math.max(0, s);
  }

  async createEdition(weekStart, articles, status) {
    if (!articles || articles.length === 0) {
      console.warn('⚠️ No articles to create weekly edition with');
      throw new Error('Cannot create weekly edition without articles');
    }
    
    let issue = 1;
    try {
      // Try to get next issue number from weekly_editions
      const { data: maxIssue, error } = await supabase
        .from('weekly_editions')
        .select('issue_number')
        .order('issue_number', { ascending: false })
        .limit(1)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.warn('⚠️ Error getting max issue number:', error.message);
      }
      
      issue = (maxIssue?.issue_number || 0) + 1;
      console.log(`📊 Using weekly issue number: ${issue}`);
    } catch (error) {
      console.warn('⚠️ Weekly issue number calculation failed, using timestamp-based number');
      issue = Math.floor(Date.now() / (7 * 86400000)); // Weekly based
    }

    const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let edition;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data: editionData, error: e1 } = await supabase
          .from('weekly_editions')
          .insert({
            week_start_date: weekStart,
            week_end_date: weekEnd,
            issue_number: issue,
            status,
            featured_headline: articles[0]?.title || 'Weekly Headlines'
          })
          .select()
          .single();
        if (e1) throw e1;
        edition = editionData;
        break;
      } catch (error) {
        console.warn(`⚠️ Weekly edition creation attempt ${attempt} failed for week ${weekStart}, issue #${issue}:`, error.message);
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
        console.warn(`⚠️ Articles insert attempt ${attempt} failed for weekly edition ${edition.id} with ${rows.length} articles:`, error.message);
        if (attempt === 3) {
          await supabase.from('weekly_editions').delete().eq('id', edition.id);
          throw error;
        }
        await this.sleep(2000);
      }
    }

    console.log(`✅ Created weekly edition #${issue} with ${articles.length} articles`);
    console.log(`📊 Weekly breakdown: ${articles.filter(a => a.status === 'published').length} published, ${articles.filter(a => a.status === 'queue').length} queued`);
    return edition;
  }

  async publishToWebsite(editionId) {
    try {
      const { error } = await supabase
        .from('weekly_editions')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', editionId);
      if (error) throw error;
      console.log('✅ Weekly edition published to website');
    } catch (error) {
      console.error('❌ publishToWebsite failed:', error.message);
      throw error;
    }
  }

  async markNewsletterSent(editionId) {
    try {
      const { error } = await supabase
        .from('weekly_editions')
        .update({ status: 'sent' })
        .eq('id', editionId);
      if (error) {
        console.warn('⚠️ Failed to mark weekly newsletter as sent:', error.message);
      } else {
        console.log('✅ Weekly newsletter marked as sent');
      }
    } catch (error) {
      console.warn('⚠️ markNewsletterSent error:', error.message);
    }
  }

  async findEdition(weekStart) {
    try {
      const { data, error } = await supabase
        .from('weekly_editions')
        .select('*')
        .eq('week_start_date', weekStart)
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
        console.log('🗑️ Found empty weekly edition, will recreate');
        await supabase.from('weekly_editions').delete().eq('id', data.id);
        return null;
      }
      return data;
    } catch (error) {
      console.error('❌ findEdition failed:', error.message);
      throw error;
    }
  }

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

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Export the class and workflow function
export { AutomatedWeeklyPublisher };

export async function runAutomatedWeeklyWorkflow() {
  const p = new AutomatedWeeklyPublisher();
  return p.runFullWorkflow();
}
