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

    // Fetch articles with improved error handling
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

  // IMPROVED: Fetch with partial failure handling and environment variable configuration
  async fetchCombinedNewsWithFallback() {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      console.error('❌ GNEWS_API_KEY not found');
      return [];
    }

    // Environment variable configuration
    const maxGeneral = process.env.GNEWS_MAX_GENERAL || '20';
    const maxPolitics = process.env.GNEWS_MAX_POLITICS || '6';
    const maxFallback = process.env.GNEWS_MAX_FALLBACK || '20';
    const country = process.env.GNEWS_COUNTRY || 'us';
    const language = process.env.GNEWS_LANGUAGE || 'en';
    const delayMs = parseInt(process.env.GNEWS_DELAY_MS || '1000');

    console.log('📡 Fetching combined news with fallback handling...');
    console.log('⚙️ Config:', { maxGeneral, maxPolitics, country, language, delayMs });
    
    let generalArticles = [];
    let politicsArticles = [];

    // TRY 1: Fetch general headlines
    try {
      console.log(`📰 Fetching ${maxGeneral} general headlines...`);
      const generalUrl = `https://gnews.io/api/v4/top-headlines?lang=${language}&country=${country}&max=${maxGeneral}&token=${API_KEY}`;
      const generalResponse = await fetch(generalUrl);
      if (generalResponse.ok) {
        const generalData = await generalResponse.json();
        generalArticles = generalData.articles || [];
        console.log(`✅ General headlines: ${generalArticles.length} articles`);
        
        // Debug GNews response
        console.log('🔍 GNews general sample:', {
          title: generalData.articles?.[0]?.title,
          description: generalData.articles?.[0]?.description,
          hasDescription: !!generalData.articles?.[0]?.description
        });
      } else {
        console.warn(`⚠️ General headlines failed: ${generalResponse.status}`);
      }
    } catch (error) {
      console.warn('⚠️ General headlines error:', error.message);
    }

    // Small delay between API calls
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // TRY 2: Fetch politics headlines
    try {
      console.log(`🏛️ Fetching ${maxPolitics} politics headlines...`);
      const politicsUrl = `https://gnews.io/api/v4/top-headlines?category=politics&lang=${language}&country=${country}&max=${maxPolitics}&token=${API_KEY}`;
      const politicsResponse = await fetch(politicsUrl);
      if (politicsResponse.ok) {
        const politicsData = await politicsResponse.json();
        politicsArticles = politicsData.articles || [];
        console.log(`✅ Politics headlines: ${politicsArticles.length} articles`);
        
        // Debug GNews response
        console.log('🔍 GNews politics sample:', {
          title: politicsData.articles?.[0]?.title,
          description: politicsData.articles?.[0]?.description,
          hasDescription: !!politicsData.articles?.[0]?.description
        });
      } else {
        console.warn(`⚠️ Politics headlines failed: ${politicsResponse.status}`);
      }
    } catch (error) {
      console.warn('⚠️ Politics headlines error:', error.message);
    }

    // FALLBACK: If both fail, try single top headlines call
    if (generalArticles.length === 0 && politicsArticles.length === 0) {
      console.log('🔄 Both calls failed, trying fallback...');
      try {
        const fallbackUrl = `https://gnews.io/api/v4/top-headlines?lang=${language}&country=${country}&max=${maxFallback}&token=${API_KEY}`;
        const fallbackResponse = await fetch(fallbackUrl);
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          generalArticles = fallbackData.articles || [];
          console.log(`✅ Fallback headlines: ${generalArticles.length} articles`);
        }
      } catch (error) {
        console.error('❌ All API calls failed:', error.message);
      }
    }

    // Combine what we have
    let allArticles = [...generalArticles, ...politicsArticles];
    console.log(`📊 Combined: ${allArticles.length} articles (${generalArticles.length} general + ${politicsArticles.length} politics)`);

    // Filter invalid articles
    allArticles = allArticles.filter(article => article?.title && article?.description);
    console.log(`📊 Valid articles: ${allArticles.length}`);

    // CONTENT FILTERING based on environment variables
    const excludeKeywords = process.env.GNEWS_EXCLUDE_KEYWORDS 
      ? process.env.GNEWS_EXCLUDE_KEYWORDS.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];
    const requireKeywords = process.env.GNEWS_REQUIRE_KEYWORDS 
      ? process.env.GNEWS_REQUIRE_KEYWORDS.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
      : [];

    if (excludeKeywords.length > 0 || requireKeywords.length > 0) {
      console.log('🔍 Applying content filters:', { 
        excludeCount: excludeKeywords.length, 
        requireCount: requireKeywords.length 
      });
      
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
        
        // Require at least one required keyword (if any specified)
        if (requireKeywords.length > 0) {
          const hasRequired = requireKeywords.some(keyword => text.includes(keyword));
          if (!hasRequired) {
            console.log(`🚫 Filtered: ${article.title.substring(0, 50)}... (missing required keywords)`);
            return false;
          }
        }
        
        return true;
      });
      
      console.log(`📊 After content filtering: ${allArticles.length} articles (removed ${beforeFilter - allArticles.length})`);
    }

    return allArticles;
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
            console.log(`  🔍 RAW AI RESPONSE:`, raw ? raw.substring(0, 200) + '...' : 'NULL');

            if (raw) {
              const cleaned = this.sanitize(a, raw);
              if (cleaned) {
                analysis = cleaned;
                console.log(`  ✅ Analysis accepted (${cleaned.split(/\s+/).length} words)`);
              } else {
                console.log(`  ❌ Analysis REJECTED by sanitize function`);
                console.log(`  📝 Full rejected text:`, raw.substring(0, 500) + '...');
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
          // analysis stays null
        }
      }

      const finalAnalysis = analysis || 'No analysis available';

      // Debug logging to see what's happening
      console.log(`🐛 DEBUG: Article ${i + 1} final analysis:`, JSON.stringify({
        hasAnalysis: !!analysis,
        analysisLength: analysis ? analysis.length : 0,
        finalAnalysisPreview: finalAnalysis.substring(0, 100) + '...',
        shouldAnalyze: shouldAnalyze,
        articleTitle: a.title?.substring(0, 50) + '...'
      }));

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
    
    // Final debug - show what we're returning
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

    // keep the inputs clean and bounded
    const cleanTitle = (article.title || '')
      .replace(/[^\w\s\-.,!?']/g, '')
      .substring(0, 200);
    const cleanDescription = (article.description || '')
      .replace(/[^\w\s\-.,!?']/g, '')
      .substring(0, 500);
    const cleanSource = (source || '')
      .replace(/[^\w\s\-.,!?']/g, '')
      .substring(0, 80);

    // Use environment variables for prompts (required - no fallbacks)
    const systemPrompt = process.env.SYSTEM_PROMPT;
    const userPromptTemplate = process.env.USER_PROMPT;
    
    if (!systemPrompt || !userPromptTemplate) {
      throw new Error('SYSTEM_PROMPT and USER_PROMPT environment variables must be set');
    }

    // Replace placeholders in the user prompt
    const prompt = userPromptTemplate
      .replace('{title}', cleanTitle)
      .replace('{description}', cleanDescription)
      .replace('{source}', cleanSource)
      .replace('{date}', pubDate);

    try {
      const requestBody = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.4
      };

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!r.ok) {
        const errorBody = await r.text();
        throw new Error(`OpenAI API error ${r.status}: ${errorBody}`);
      }

      const data = await r.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenAI returned empty content');
      return content.trim();
    } catch (error) {
      console.error('❌ OpenAI API call failed:', error.message);
      throw error;
    }
  }

  sanitize(article, text) {
    // Normalize and strip carriage returns
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

    // Check for bullet points or numbered lists
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`  ❌ Formatting rejected: bullet points/numbered lists detected`);
      return null;
    }

    console.log(`  ✅ Sanitize passed: ${wc} words, flowing prose format`);
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

    // Debug what we're trying to save
    console.log(`🐛 DEBUG: Saving ${rows.length} articles to database`);
    rows.forEach((row, i) => {
      console.log(`🐛 Article ${i + 1}: analysis_text = ${row.analysis_text ? row.analysis_text.substring(0, 50) + '...' : 'NULL'}`);
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
        if (e2) throw e2;
        
        // Debug: Verify what was actually saved
        const { data: savedArticles } = await supabase
          .from('analyzed_articles')
          .select('id, title, analysis_text')
          .eq('edition_id', edition.id)
          .limit(3);
        
        console.log(`🐛 DEBUG: First 3 saved articles:`, savedArticles?.map(a => ({
          id: a.id,
          title: a.title?.substring(0, 30) + '...',
          hasAnalysis: !!a.analysis_text,
          analysisLength: a.analysis_text?.length || 0
        })));
        
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
