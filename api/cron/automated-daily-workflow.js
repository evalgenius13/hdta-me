// api/cron/automated-daily-workflow.js - UPDATED: Human Impact Focus (not just policy)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 26;      // 26 total articles
    this.numAnalyzed = 6;       // First 6 get AI analysis
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

    const selected = await this.selectBest(articles);
    console.log('🟡 selectBest after filtering:', selected.length, 'articles');

    const analyzed = await this.analyzeAll(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  // NEW: Targeted search for human impact stories
  async fetchCombinedNewsWithFallback() {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      console.error('❌ GNEWS_API_KEY not found');
      return [];
    }

    console.log('📡 Fetching targeted human impact stories...');
    
    // Targeted search query for human impact stories with expanded synonyms
    const searchQuery = encodeURIComponent(
      '("government policy" OR "state policy" OR "federal policy" OR "federal funding" OR "state funding" OR "law change" OR "new law" OR "legislation" OR "regulation" OR "policy shift" OR "policy update" OR "executive order" OR "court ruling") AND ("privacy rights" OR "data privacy" OR "AI regulation" OR "artificial intelligence regulation" OR "social media privacy" OR "data protection" OR "surveillance" OR "housing costs" OR "rental prices" OR "rent control" OR "eviction" OR "foreclosure" OR "affordable housing" OR "immigration reform" OR "deportation" OR "visa requirements" OR "border policy" OR "asylum" OR "immigration status" OR "abortion access" OR "reproductive rights" OR "abortion ban" OR "abortion law" OR "civil rights" OR "discrimination" OR "workplace rights" OR "voting rights" OR "human rights" OR "humanitarian rights" OR "student loans" OR "tuition costs" OR "education funding" OR "school funding" OR "minimum wage" OR "worker pay" OR "labor rights" OR "unemployment benefits" OR "healthcare access" OR "medical costs") AND ("United States" OR "US" OR "USA" OR "America" OR "American") AND (impact OR effect OR consequences OR affects OR "affects people" OR "affects families" OR "affects workers" OR "affects students" OR "community response" OR "human story" OR "real impact" OR "personal impact")'
    );

    let allArticles = [];

    try {
      console.log('🎯 Searching for human impact stories...');
      const searchUrl = `https://gnews.io/api/v4/search?q=${searchQuery}&lang=en&country=us&max=26&token=${API_KEY}`;
      
      const response = await fetch(searchUrl);
      if (response.ok) {
        const data = await response.json();
        allArticles = data.articles || [];
        console.log(`✅ Found ${allArticles.length} human impact stories`);
      } else {
        console.warn(`⚠️ Targeted search failed: ${response.status}`);
        throw new Error(`Search API failed: ${response.status}`);
      }
    } catch (error) {
      console.warn('⚠️ Targeted search error:', error.message);
      
      // FALLBACK: If targeted search fails, try simpler query
      try {
        console.log('🔄 Trying fallback search...');
        const fallbackQuery = encodeURIComponent('("government policy" OR "federal funding") AND ("United States" OR "US") AND (impact OR effect)');
        const fallbackUrl = `https://gnews.io/api/v4/search?q=${fallbackQuery}&lang=en&country=us&max=26&token=${API_KEY}`;
        
        const fallbackResponse = await fetch(fallbackUrl);
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          allArticles = fallbackData.articles || [];
          console.log(`✅ Fallback search: ${allArticles.length} articles`);
        }
      } catch (fallbackError) {
        console.error('❌ All searches failed:', fallbackError.message);
      }
    }

    // Filter invalid articles
    allArticles = allArticles.filter(article => {
      if (!article?.title || !article?.description) {
        return false;
      }
      return true;
    });

    console.log(`📊 Valid human impact articles: ${allArticles.length}`);
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
          const raw = await this.generateHumanImpactAnalysis(a).catch(() => null);
          const cleaned = raw ? this.sanitize(a, raw) : null;
          if (cleaned) analysis = cleaned;
          if (!analysis) await this.sleep(this.retryDelay);
        }
        if (!analysis) analysis = this.fallback();
      }

      const finalAnalysis = analysis || this.queueFallback();

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

  async selectBest(list) {
    console.log('🔍 Starting selection with', list.length, 'articles');
    
    const deduped = this.dedupe(list);
    console.log('🔍 After deduplication:', deduped.length, 'articles');
    
    const scored = deduped.map(a => ({ ...a, score: this.scoreHumanImpact(a) }));
    
    const final = scored
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
      
    console.log('🔍 Final selection:', final.length, 'articles');
    final.forEach((a, i) => {
      console.log(`  ${i + 1}. Score ${a.score}: ${a.title.substring(0, 60)}...`);
    });
    
    return final;
  }

  // IMPROVED: Better database error handling
  async createEdition(date, articles, status) {
    const { data: next } = await supabase.rpc('get_next_issue_number');
    const issue = next || 1;

    if (!articles || articles.length === 0) {
      console.warn('⚠️ No articles to create edition with');
      throw new Error('Cannot create edition without articles');
    }

    // Create edition with retry logic
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
        console.warn(`⚠️ Edition creation attempt ${attempt} failed:`, error.message);
        if (attempt === 3) throw error;
        await this.sleep(2000); // Wait before retry
      }
    }

    // Insert articles with retry logic
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
        console.warn(`⚠️ Articles insert attempt ${attempt} failed:`, error.message);
        if (attempt === 3) {
          // Clean up edition if articles can't be inserted
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

  fallback() {
    this.logFallbackUsage('generation_failed', 'AI generation or sanitization failed');
    return 'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

  queueFallback() {
    return 'This story is in the queue for detailed analysis. The human impact assessment will explore how this affects individuals, families, and communities once the full analysis is completed.';
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

  // UPDATED: Human Impact Scoring (beyond just policy)
  scoreHumanImpact(article) {
    let s = 0;
    const t = (article.title + ' ' + (article.description || '')).toLowerCase();
    
    // HIGH VALUE: Direct human impact keywords
    const highImpactKeywords = [
      'affects families', 'affects workers', 'affects students', 'affects parents', 'affects seniors',
      'civil rights', 'human rights', 'discrimination', 'workplace protections',
      'abortion access', 'reproductive rights', 'healthcare access',
      'immigration status', 'deportation', 'visa requirements',
      'privacy rights', 'data collection', 'surveillance',
      'housing costs', 'rent control', 'foreclosure', 'eviction',
      'student loans', 'school funding', 'education access',
      'minimum wage', 'unemployment benefits', 'social security'
    ];
    highImpactKeywords.forEach(k => {
      if (t.includes(k)) s += 20;
    });
    
    // HIGH VALUE: Government/Legal action (policy filter)
    const policyKeywords = [
      'executive order', 'supreme court', 'congress passes', 'senate votes', 
      'bill signed', 'federal ruling', 'court decision', 'new law',
      'regulation', 'policy change', 'government announces'
    ];
    policyKeywords.forEach(k => {
      if (t.includes(k)) s += 15;
    });
    
    // MEDIUM VALUE: Human-centered terms
    const humanCenteredKeywords = [
      'families', 'workers', 'students', 'parents', 'seniors', 'children',
      'communities', 'residents', 'citizens', 'employees', 'tenants',
      'patients', 'consumers', 'taxpayers', 'voters', 'immigrants'
    ];
    humanCenteredKeywords.forEach(k => {
      if (t.includes(k)) s += 10;
    });
    
    // MEDIUM VALUE: Rights and protections
    const rightsKeywords = [
      'rights', 'protections', 'access', 'benefits', 'services',
      'safety', 'security', 'freedom', 'equality', 'fairness',
      'justice', 'legal', 'court', 'lawsuit', 'settlement'
    ];
    rightsKeywords.forEach(k => {
      if (t.includes(k)) s += 8;
    });
    
    // MEDIUM VALUE: Financial impact
    const financialKeywords = [
      'cost', 'price', 'tax', 'fee', 'fine', 'penalty', 'savings',
      'income', 'wage', 'salary', 'benefit', 'subsidy', 'funding'
    ];
    financialKeywords.forEach(k => {
      if (t.includes(k)) s += 8;
    });
    
    // LOW VALUE: General policy terms
    const generalPolicyKeywords = [
      'congress', 'senate', 'house', 'federal', 'government', 'policy', 
      'legislation', 'political', 'election', 'campaign'
    ];
    generalPolicyKeywords.forEach(k => {
      if (t.includes(k)) s += 5;
    });
    
    // NEGATIVE: Reduce fluff and opinion content
    const negativeKeywords = [
      'celebrity', 'entertainment', 'sports', 'opinion', 'editorial',
      'analysis:', 'commentary', 'review', 'prediction', 'speculation',
      'rumors', 'gossip', 'viral', 'trending', 'social media drama'
    ];
    negativeKeywords.forEach(k => {
      if (t.includes(k)) s -= 10;
    });
    
    // Recency bonus
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 8;
      else if (hrs < 12) s += 5;
      else if (hrs < 24) s += 3;
    }
    
    // Quality source bonus
    const qualitySources = [
      'reuters', 'ap news', 'bloomberg', 'wall street journal', 
      'washington post', 'new york times', 'politico', 'cnn', 'fox news',
      'npr', 'pbs', 'usa today', 'abc news', 'cbs news', 'nbc news'
    ];
    if (qualitySources.some(src => (article.source?.name || '').toLowerCase().includes(src))) {
      s += 5;
    }
    
    return Math.max(0, s);
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
    if (wc < 150 || wc > 300) { // Increased word count for story format
      this.logFallbackUsage('word_count', `${wc} words`);
      return null;
    }

    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      this.logFallbackUsage('formatting', 'bullet points detected');
      return null;
    }

    const inputs = [article.title || '', article.description || '', article.publishedAt || '']
      .join(' ')
      .toLowerCase();
    const years = normalized.match(/\b(20[0-2]\d)\b/g) || [];
    for (const year of years) {
      const yearNum = parseInt(year);
      const currentYear = new Date().getFullYear();
      if (yearNum >= currentYear - 5 && yearNum <= currentYear + 1) {
        if (!inputs.includes(year.toLowerCase())) {
          this.logFallbackUsage('invalid_year', `year ${year} not in source`);
          return null;
        }
      }
    }

    return normalized;
  }

  logFallbackUsage(reason, details) {
    const timestamp = new Date().toISOString();
    console.log(`🔄 FALLBACK USED: ${reason} - ${details} at ${timestamp}`);
  }

  // NEW: Human Impact Analysis Generation
  async generateHumanImpactAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write a plain-English analysis in story format, using clear headings and bold for structure.  
Start by describing how the issue directly affects the main group involved ("how does this affect me?"), then expand to show ripple effects on families, communities, and other stakeholders.  
Be specific about real-world consequences and emotions, not just official statements.  
Include a section on who benefits and who loses out.  
Point out any hidden or missing impacts that aren't mentioned in the article.  
Explain how this fits into the larger political or policy landscape—mention any motivations, trends, or strategies behind the issue.
**In your final section, always connect the issue to all readers—even those not directly affected.**  
Explain why this story matters for everyone, such as setting a precedent, affecting community values, or having broader implications for rights, safety, or fairness.
Keep paragraphs short and language easy to read.

**Format:**
# [Title: What's happening?]
**[Short summary or key impact]**

## How this affects the main group
[Describe everyday effects, feelings, risks, and behavior.]

## Ripple effects on others
[Explain impacts on families, teachers, local communities, etc.]

## Winners and losers
[Who benefits, who faces new risks or losses?]

## What's not being said
[Highlight important consequences or details missing from the article.]

## Political and policy context
[Explain the bigger picture—political motivation, trends, or strategies.]

## Why this matters for everyone
[Connect the story to all readers—explain broader relevance, precedent, values, or risks.]

Story: "${article.title}"
Details: "${article.description}"
Source: "${source}"
Date: "${pubDate}"
`.trim();

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
            { 
              role: 'system', 
              content: 'You are an expert at explaining how news stories affect real people\'s lives. Focus on human impact, emotions, and practical consequences. Write in clear, accessible language that helps readers understand why the story matters to them personally and their community.' 
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 400, // Increased for story format
          temperature: 0.4
        })
      });

      if (!r.ok) {
        throw new Error(`OpenAI API error ${r.status}: ${r.statusText}`);
      }

      const data = await r.json();
      return (data.choices?.[0]?.message?.content || '').trim();
    } catch (error) {
      console.error('OpenAI API call failed:', error.message);
      throw error;
    }
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
          return null;  // No edition found - normal case
        }
        throw error;
      }
      
      // Check if edition has articles
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
