// api/cron/automated-daily-workflow.js - FINAL VERSION with improved error handling
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

  // IMPROVED: Fetch with partial failure handling
  async fetchCombinedNewsWithFallback() {
    const API_KEY = process.env.GNEWS_API_KEY;
    if (!API_KEY) {
      console.error('❌ GNEWS_API_KEY not found');
      return [];
    }

    console.log('📡 Fetching combined news with fallback handling...');
    
    let generalArticles = [];
    let politicsArticles = [];

    // TRY 1: Fetch general headlines
    try {
      console.log('📰 Fetching 20 general headlines...');
      const generalUrl = `https://gnews.io/api/v4/top-headlines?lang=en&country=us&max=20&token=${API_KEY}`;
      
      const generalResponse = await fetch(generalUrl);
      if (generalResponse.ok) {
        const generalData = await generalResponse.json();
        generalArticles = generalData.articles || [];
        console.log(`✅ General headlines: ${generalArticles.length} articles`);
      } else {
        console.warn(`⚠️ General headlines failed: ${generalResponse.status}`);
      }
    } catch (error) {
      console.warn('⚠️ General headlines error:', error.message);
    }

    // Small delay between API calls
    await new Promise(resolve => setTimeout(resolve, 1000));

    // TRY 2: Fetch politics headlines
    try {
      console.log('🏛️ Fetching 6 politics headlines...');
      const politicsUrl = `https://gnews.io/api/v4/top-headlines?category=politics&lang=en&country=us&max=6&token=${API_KEY}`;
      
      const politicsResponse = await fetch(politicsUrl);
      if (politicsResponse.ok) {
        const politicsData = await politicsResponse.json();
        politicsArticles = politicsData.articles || [];
        console.log(`✅ Politics headlines: ${politicsArticles.length} articles`);
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
        const fallbackUrl = `https://gnews.io/api/v4/top-headlines?lang=en&country=us&max=20&token=${API_KEY}`;
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
    allArticles = allArticles.filter(article => {
      if (!article?.title || !article?.description) {
        return false;
      }
      return true;
    });

    console.log(`📊 Valid articles: ${allArticles.length}`);
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
          const raw = await this.generateNarrative(a).catch(() => null);
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
    return 'This article is in the queue for detailed analysis. The policy impact assessment will consider implementation timelines, affected stakeholders, and practical consequences for individuals and businesses once the full analysis is completed.';
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
    
    // High value keywords
    const highValue = ['executive order', 'supreme court', 'congress passes', 'senate votes', 'bill signed', 'federal ruling', 'white house', 'biden', 'trump'];
    highValue.forEach(k => {
      if (t.includes(k)) s += 15;
    });
    
    // Medium value keywords
    const mediumValue = ['congress', 'senate', 'house', 'federal', 'government', 'policy', 'legislation', 'court', 'judge', 'ruling', 'election', 'political'];
    mediumValue.forEach(k => {
      if (t.includes(k)) s += 8;
    });
    
    // Low value keywords
    const lowValue = ['mayor', 'governor', 'local', 'state', 'business', 'economy', 'health', 'education'];
    lowValue.forEach(k => {
      if (t.includes(k)) s += 3;
    });
    
    // Negative keywords
    const negative = ['celebrity', 'entertainment', 'sports', 'death', 'dies', 'shooting', 'crime'];
    negative.forEach(k => {
      if (t.includes(k)) s -= 5;
    });
    
    // Recency bonus
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 8;
      else if (hrs < 12) s += 5;
      else if (hrs < 24) s += 3;
    }
    
    // Quality source bonus
    const qualitySources = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post', 'new york times', 'politico', 'cnn', 'fox news'];
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
    if (wc < 100 || wc > 250) {
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

  async generateNarrative(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    const prompt = `
Write exactly 140-170 words as a compelling insider analysis that reveals what's really happening. Use plain English but show deep policy knowledge.

Paragraph 1 - REAL IMPACT (30-40 words): Start with the concrete consequence people will actually feel. Be specific: "Your mortgage rate jumps 0.3%" not "rates may change." Think like someone who's seen this playbook before.

Paragraph 2 - THE MECHANICS (40-50 words): Explain HOW this works in practice. Include specific timelines, dollar amounts, eligibility thresholds. What's the implementation reality vs. the press release version?

Paragraph 3 - WINNERS & LOSERS (40-50 words): Name who actually benefits and who gets hurt. Be specific about industries, regions, demographics when the data supports it. Don't be vague - if community banks struggle while big banks thrive, say so directly.

Paragraph 4 - INSIDER PERSPECTIVE (25-35 words): What's not being said publicly? Historical precedent? Hidden timelines? Real motivations? End with what to watch for next that signals the true impact.

Policy: "${article.title}"
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
            { role: 'system', content: 'You are a seasoned policy insider who explains complex regulations in terms of real human impact. Be specific, credible, and revealing about how policy actually works. Avoid jargon but show deep expertise.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 280,
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
