import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 20; // Total articles to store
    this.numAnalyzed = 6;  // Articles to analyze for main site
    this.maxRetries = 3;   // Analysis retry attempts
    this.retryDelay = 1500; // Delay between retries
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
    console.log('🔵 fetchPolicyNews returned:', articles.length, 'articles');
    
    const selected = await this.selectBest(articles);
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

      // Only analyze top numAnalyzed articles for main site
      const shouldAnalyze = i < this.numAnalyzed;
      
      if (shouldAnalyze) {
        console.log(`🔬 Analyzing article ${i + 1}: ${a.title.substring(0, 60)}...`);

        for (let attempt = 0; attempt < this.maxRetries && !analysis; attempt++) {
          const raw = await this.generateNarrative(a).catch(() => null);
          const cleaned = raw ? this.sanitize(a, raw) : null;
          if (cleaned) analysis = cleaned;
          if (!analysis) await this.sleep(this.retryDelay);
        }

        if (!analysis) analysis = this.fallback();
      }

      out.push({
        ...a,
        order: i < this.numAnalyzed ? i + 1 : null, // Only top numAnalyzed get order numbers
        analysis,
        analysis_generated_at: analysis ? new Date().toISOString() : null,
        analysis_word_count: analysis ? analysis.split(/\s+/).filter(Boolean).length : 0,
        status: i < this.numAnalyzed ? 'published' : 'queue', // Simple status
        score: a.score || 0
      });
    }
    return out;
  }

  async selectBest(list) {
    const filtered = list.filter(
      a =>
        a?.title &&
        a?.description &&
        !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks|sports|rapper|kardashian|tesla stock|bitcoin)\b/i.test(a.title) &&
        /\b(bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves|ruling|decision|agency|federal)\b/i.test(
          (a.title || '') + ' ' + (a.description || '')
        )
    );
    
    const deduped = this.dedupe(filtered);
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    
    return scored
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
  }

  async createEdition(date, articles, status) {
    const { data: next } = await supabase.rpc('get_next_issue_number');
    const issue = next || 1;

    // Check for empty articles array
    if (!articles || articles.length === 0) {
      console.warn('⚠️ No articles to create edition with');
    }

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

    // Only insert articles if we have them
    if (articles && articles.length > 0) {
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
        analysis_word_count: a.analysis_word_count,
        article_status: a.status,
        article_score: a.score
      }));

      const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
      if (e2) throw e2;

      console.log(`✅ Created edition #${issue} with ${articles.length} articles (top ${this.numAnalyzed} analyzed)`);
    } else {
      console.log(`✅ Created empty edition #${issue}`);
    }

    return edition;
  }

  // Fallback only needs to be defined ONCE
  fallback() {
    this.logFallbackUsage('generation_failed', 'AI generation or sanitization failed');
    return 'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

  // ... rest of your helper methods (scoreAndCategorizeAll, analyzeSelected, filterValidArticles, etc.) ...
  // Make sure you don't define the same method twice!

  // Track fallback usage for monitoring
  logFallbackUsage(reason, details) {
    const timestamp = new Date().toISOString();
    console.log(`🔄 FALLBACK USED: ${reason} - ${details} at ${timestamp}`);
    // In production, this could be sent to monitoring service
  }

  // ... (other methods remain unchanged, but remove any duplicate method definitions) ...

  // UPDATED: Fetch articles from the last 3 days, and log all titles for debugging
  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      // Expanded query to catch more policy content
      const query = 'congress OR senate OR "executive order" OR regulation OR "supreme court" OR "federal agency" OR "new rule" OR "bill signed" OR governor OR legislature OR "court ruling" OR EPA OR FDA OR IRS OR "policy change"';

      // Use a 3-day rolling window for more content
      const today = new Date();
      const fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 3);
      const fromStr = fromDate.toISOString().split('T')[0];
      const toStr = today.toISOString().split('T')[0];

      // Increased max articles to get more options
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=30&from=${fromStr}&to=${toStr}&token=${API_KEY}`;

      const response = await fetch(url);
      const data = await response.json();

      console.log('GNews API response status:', response.status);
      console.log('GNews API response keys:', Object.keys(data || {}));

      const articles = Array.isArray(data.articles) ? data.articles : [];
      console.log(`✅ Fetched ${articles.length} articles from GNews`);
      
      articles.forEach((a, i) => {
        if (a && a.title) {
          const recency = a.publishedAt ? this.getTimeAgo(a.publishedAt) : 'no date';
          console.log(`Article ${i + 1} (${recency}): ${a.title.substring(0, 80)}...`);
        }
      });

      return articles;
    } catch (error) {
      console.error('❌ Failed to fetch news:', error);
      return [];
    }
  }

  // (other methods: dedupe, jaccard, score, publishToWebsite, markNewsletterSent, findEdition, getTimeAgo, sleep, etc.)
  // Make sure there are NO duplicate method definitions.
}

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
