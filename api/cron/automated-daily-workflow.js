import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 20; // Total articles to store
    this.numAnalyzed = 6;  // Articles to analyze for main site
    this.maxRetries = 3;   // Analysis retry attempts
    this.retryDelay = 1500; // Delay between retries (ms)
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

      out.push({
        ...a,
        order: i + 1, // FIX: Always assign an order (1-based), not just for analyzed articles
        analysis,
        analysis_generated_at: analysis ? new Date().toISOString() : null,
        analysis_word_count: analysis ? analysis.split(/\s+/).filter(Boolean).length : 0,
        status: shouldAnalyze ? 'published' : 'queue',
        score: a.score || 0
      });
    }
    return out;
  }

  async selectBest(list) {
    console.log('🔍 Starting with', list.length, 'politics articles from GNews');
    
    // No complex filtering needed - politics category already gives us what we want
    // Just remove duplicates and score them
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

  async createEdition(date, articles, status) {
    const { data: next } = await supabase.rpc('get_next_issue_number');
    const issue = next || 1;

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

  fallback() {
    this.logFallbackUsage('generation_failed', 'AI generation or sanitization failed');
    return 'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

  // FIXED: Use GNews politics category - much simpler and more reliable
  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      if (!API_KEY) {
        console.error('❌ GNEWS_API_KEY not found in environment variables');
        return [];
      }

      console.log('📡 Fetching politics headlines from GNews...');
      
      // Use politics category - gets exactly what we want without complex filtering
      const url = `https://gnews.io/api/v4/top-headlines?category=politics&lang=en&country=us&max=50&token=${API_KEY}`;

      const response = await fetch(url);
      
      console.log('GNews Politics API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ GNews Politics API error:', response.status, errorText);
        return [];
      }

      const data = await response.json();
      
      console.log('GNews Politics API response keys:', Object.keys(data || {}));
      console.log('Total politics articles available:', data.totalArticles || 0);

      const articles = Array.isArray(data.articles) ? data.articles : [];
      console.log(`📰 Raw politics articles fetched: ${articles.length}`);

      if (articles.length === 0) {
        console.warn('⚠️ No politics articles returned from GNews');
        return [];
      }

      // Simple filtering - just remove obviously non-policy content
      const cleanArticles = articles.filter(article => {
        if (!article?.title || !article?.description) {
          console.log(`❌ Skipping article with missing title/description`);
          return false;
        }
        
        const content = (article.title + ' ' + article.description).toLowerCase();
        
        // Only exclude obvious non-policy content (sports that sometimes appear in politics)
        const excludeKeywords = ['nfl', 'nba', 'mlb', 'nhl', 'sports scores', 'game highlights'];
        const hasExcluded = excludeKeywords.some(keyword => content.includes(keyword));
        
        if (hasExcluded) {
          console.log(`❌ Excluding sports content: ${article.title.substring(0, 50)}...`);
          return false;
        }
        
        console.log(`✅ Politics article: ${article.title.substring(0, 60)}...`);
        return true;
      });

      console.log(`✅ After basic filtering: ${cleanArticles.length} politics articles`);
      
      // Log sample articles for debugging
      cleanArticles.slice(0, 10).forEach((a, i) => {
        const recency = a.publishedAt ? this.getTimeAgo(a.publishedAt) : 'no date';
        console.log(`Article ${i + 1} (${recency}): ${a.title.substring(0, 80)}...`);
      });

      return cleanArticles;
      
    } catch (error) {
      console.error('❌ Failed to fetch politics headlines:', error);
      return [];
    }
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
    
    // High value keywords - government action
    const highValue = ['executive order', 'supreme court', 'congress passes', 'senate votes', 'bill signed', 'federal ruling', 'white house', 'biden', 'trump'];
    highValue.forEach(k => {
      if (t.includes(k)) s += 15;
    });
    
    // Medium value keywords - policy/government
    const mediumValue = ['congress', 'senate', 'house', 'federal', 'government', 'policy', 'legislation', 'court', 'judge', 'ruling', 'election', 'political'];
    mediumValue.forEach(k => {
      if (t.includes(k)) s += 8;
    });
    
    // Low value keywords - general politics
    const lowValue = ['mayor', 'governor', 'local', 'state', 'political', 'campaign', 'vote'];
    lowValue.forEach(k => {
      if (t.includes(k)) s += 3;
    });
    
    // Negative keywords - reduce score
    const negative = ['celebrity', 'entertainment', 'sports', 'death', 'dies', 'shooting', 'crime'];
    negative.forEach(k => {
      if (t.includes(k)) s -= 5;
    });
    
    // Recency bonus
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 6) s += 8;   // Very recent
      else if (hrs < 12) s += 5;  // Recent  
      else if (hrs < 24) s += 3;  // Today
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
    console.log(`    📊 Word count: ${wc} (need 100-250)`);
    if (wc < 100 || wc > 250) {
      console.log(`    ❌ Rejected: word count ${wc} outside 100-250 range`);
      this.logFallbackUsage('word_count', `${wc} words`);
      return null;
    }

    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`    ❌ Rejected: contains bullet points or numbered lists`);
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
          console.log(`    ❌ Rejected: mentions recent year ${year} not in source material`);
          this.logFallbackUsage('invalid_year', `year ${year} not in source`);
          return null;
        }
      }
    }

    console.log(`    ✅ Sanitization passed`);
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

Use concrete language:
- "implementation" → "when it starts"
- "stakeholders" → specific groups affected
- "regulatory framework" → "new rules"
- "may impact" → "will cost" or "will benefit"

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
        if (r.status === 429) {
          throw new Error(`OpenAI rate limit hit (429) - will retry`);
        } else if (r.status === 401) {
          throw new Error(`OpenAI authentication failed (401) - check API key`);
        } else {
          throw new Error(`OpenAI API error ${r.status}: ${r.statusText}`);
        }
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

      if (error) {
        console.error('❌ Failed to publish to website:', error);
        throw error;
      }

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
        console.error('❌ Error finding edition:', error);
        throw error;
      }
      
      // If edition exists but is empty (no articles), treat as if no edition exists
      const { data: articles } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', data.id)
        .limit(1);
        
      if (!articles || articles.length === 0) {
        console.log('🗑️ Found empty edition, will recreate with articles');
        // Delete the empty edition
        await supabase.from('daily_editions').delete().eq('id', data.id);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('❌ findEdition failed:', error.message);
      throw error;
    }
  }

  getTimeAgo(publishedAt) {
    if (!publishedAt) return 'unknown time';
    const now = new Date();
    const pub = new Date(publishedAt);
    const hours = Math.floor((now - pub) / 3600000);
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'just published';
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    return pub.toLocaleDateString();
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
