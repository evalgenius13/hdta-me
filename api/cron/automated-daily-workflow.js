// api/cron/automated-daily-workflow.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 6;
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
    
    const scored = await this.scoreAndCategorizeAll(articles);
    console.log('🟡 scoreAndCategorizeAll processed:', scored.length, 'articles');
    
    const analyzed = await this.analyzeSelected(scored);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  async scoreAndCategorizeAll(articles) {
    // Filter and dedupe all articles
    const filtered = this.filterValidArticles(articles);
    console.log(`🔽 After content filtering: ${filtered.length} articles`);
    
    const deduped = this.dedupe(filtered);
    console.log(`🔽 After deduplication: ${deduped.length} articles`);
    
    // Score all articles
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    const sorted = scored.sort((x, y) => y.score - x.score);
    
    // Categorize articles by score and position
    const categorized = sorted.map((article, index) => {
      let status, shouldAnalyze;
      
      if (index < 6) {
        // Top 6 = Published (analyze immediately)
        status = 'published';
        shouldAnalyze = true;
        article.order = index + 1;
      } else if (index < 12) {
        // Next 6 = Drafts (analyze for potential promotion)
        status = 'draft';
        shouldAnalyze = true;
      } else if (index < 20) {
        // Next 8 = Queue (don't analyze yet, but available)
        status = 'queue';
        shouldAnalyze = false;
      } else {
        // Rest = Rejected (low scores, keep for reference)
        status = 'rejected';
        shouldAnalyze = false;
      }
      
      return { ...article, status, shouldAnalyze };
    });
    
    console.log('📊 Article categorization:');
    console.log(`  Published: ${categorized.filter(a => a.status === 'published').length}`);
    console.log(`  Drafts: ${categorized.filter(a => a.status === 'draft').length}`);
    console.log(`  Queue: ${categorized.filter(a => a.status === 'queue').length}`);
    console.log(`  Rejected: ${categorized.filter(a => a.status === 'rejected').length}`);
    
    return categorized;
  }

  async analyzeSelected(articles) {
    const toAnalyze = articles.filter(a => a.shouldAnalyze);
    const analyzed = [];
    
    console.log(`\n🔬 Analyzing ${toAnalyze.length} articles (published + drafts)`);
    
    for (let i = 0; i < toAnalyze.length; i++) {
      const a = toAnalyze[i];
      let analysis = null;

      console.log(`\n🔬 Analyzing article ${i + 1}/${toAnalyze.length}: ${a.title.substring(0, 60)}...`);

      // Try up to 3 attempts
      for (let attempt = 0; attempt < 3 && !analysis; attempt++) {
        console.log(`  Attempt ${attempt + 1}/3...`);
        
        const raw = await this.generateNarrative(a).catch(err => {
          console.log(`    ❌ AI generation failed: ${err.message}`);
          return null;
        });
        
        if (raw) {
          console.log(`    ✅ AI generated ${raw.length} characters`);
          const cleaned = this.sanitize(a, raw);
          if (cleaned) {
            analysis = cleaned;
            console.log(`    ✅ Analysis accepted (${analysis.split(/\s+/).length} words)`);
          } else {
            console.log(`    ❌ Analysis rejected by sanitizer`);
          }
        }
        
        if (!analysis && attempt < 2) {
          console.log(`    ⏳ Waiting before retry...`);
          await this.sleep(1500);
        }
      }

      if (!analysis) {
        analysis = this.fallback();
        console.log(`    🔄 Using fallback content`);
      }

      analyzed.push({
        ...a,
        analysis,
        analysis_generated_at: new Date().toISOString(),
        analysis_word_count: analysis.split(/\s+/).filter(Boolean).length
      });
    }
    
    // Add non-analyzed articles without analysis
    const nonAnalyzed = articles.filter(a => !a.shouldAnalyze).map(a => ({
      ...a,
      analysis: null,
      analysis_generated_at: null,
      analysis_word_count: 0
    }));
    
    return [...analyzed, ...nonAnalyzed];
  }

  filterValidArticles(list) {
    return list.filter(a =>
      a?.title &&
      a?.description &&
      // Re-enable filtering to exclude non-policy content
      !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks|sports|rapper|kardashian|tesla stock|bitcoin)\b/i.test(a.title) &&
      // Must contain at least one policy-relevant term
      /\b(bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves|ruling|decision|agency|federal)\b/i.test(
        (a.title || '') + ' ' + (a.description || '')
      )
    );
  }

  async analyzeAll(articles) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;

      console.log(`\n🔬 Analyzing article ${i + 1}: ${a.title.substring(0, 60)}...`);

      // Try up to 3 attempts with different strategies
      for (let attempt = 0; attempt < 3 && !analysis; attempt++) {
        console.log(`  Attempt ${attempt + 1}/3...`);
        
        const raw = await this.generateNarrative(a).catch(err => {
          console.log(`    ❌ AI generation failed: ${err.message}`);
          return null;
        });
        
        if (raw) {
          console.log(`    ✅ AI generated ${raw.length} characters`);
          const cleaned = this.sanitize(a, raw);
          if (cleaned) {
            analysis = cleaned;
            console.log(`    ✅ Analysis accepted (${analysis.split(/\s+/).length} words)`);
          } else {
            console.log(`    ❌ Analysis rejected by sanitizer`);
            console.log(`    Raw preview: ${raw.substring(0, 100)}...`);
          }
        }
        
        if (!analysis && attempt < 2) {
          console.log(`    ⏳ Waiting before retry...`);
          await this.sleep(1500);
        }
      }

      if (!analysis) {
        analysis = this.fallback();
        console.log(`    🔄 Using fallback content`);
      }

      out.push({
        ...a,
        order: i + 1,
        analysis,
        analysis_generated_at: new Date().toISOString(),
        analysis_word_count: analysis.split(/\s+/).filter(Boolean).length
      });
    }
    return out;
  }

  async generateNarrative(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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

    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const data = await r.json();
    return (data.choices?.[0]?.message?.content || '').trim();
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
    
    // Relaxed word count limits
    if (wc < 100 || wc > 250) {
      console.log(`    ❌ Rejected: word count ${wc} outside 100-250 range`);
      return null;
    }

    // Check for unwanted formatting
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      console.log(`    ❌ Rejected: contains bullet points or numbered lists`);
      return null;
    }

    // Relaxed year checking - only reject obvious fabrications
    const inputs = [article.title || '', article.description || '', article.publishedAt || '']
      .join(' ')
      .toLowerCase();
    const years = normalized.match(/\b(20[0-2]\d)\b/g) || []; // Only check recent years
    
    for (const year of years) {
      const yearNum = parseInt(year);
      const currentYear = new Date().getFullYear();
      
      // Only reject if it's a very recent year (last 5 years) that's not in source
      if (yearNum >= currentYear - 5 && yearNum <= currentYear + 1) {
        if (!inputs.includes(year.toLowerCase())) {
          console.log(`    ❌ Rejected: mentions recent year ${year} not in source material`);
          return null;
        }
      }
    }

    console.log(`    ✅ Sanitization passed`);
    return normalized;
  }

  fallback() {
    return 'The real impact depends on implementation details still being negotiated behind closed doors. Early movers with good legal counsel typically fare better, while those who wait face higher compliance costs and fewer options.\n\nSimilar policies have shifted market dynamics within 12-18 months. Watch for the regulatory guidance in Q3 - that\'s where the actual rules get written, often favoring established players over newcomers.\n\nHidden costs like processing delays, new paperwork requirements, and changed eligibility criteria usually surface 6 months after implementation.';
  }

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
  async selectBest(list) {
    // Re-enable filtering to exclude non-policy content
    const filtered = list.filter(
      a =>
        a?.title &&
        a?.description &&
        !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks|sports|rapper|kardashian|tesla stock|bitcoin)\b/i.test(a.title) &&
        // Must contain at least one policy-relevant term
        /\b(bill|law|court|legislature|governor|congress|senate|regulation|rule|policy|executive|signed|passed|approves|ruling|decision|agency|federal)\b/i.test(
          (a.title || '') + ' ' + (a.description || '')
        )
    );
    console.log(`🔽 After content filtering: ${filtered.length} articles`);
    
    const deduped = this.dedupe(filtered);
    console.log(`🔽 After deduplication: ${deduped.length} articles`);
    
    const scored = deduped.map(a => ({ ...a, score: this.score(a) }));
    const sorted = scored.sort((x, y) => y.score - x.score);
    
    // Log top articles with scores for debugging
    console.log('🏆 Top scored articles:');
    sorted.slice(0, 8).forEach((a, i) => {
      const recency = a.publishedAt ? this.getTimeAgo(a.publishedAt) : 'no date';
      console.log(`  ${i + 1}. Score: ${a.score} (${recency}) - ${a.title.substring(0, 70)}...`);
    });
    
    return sorted.slice(0, this.maxArticles);
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
        if (sim > 0.75) { // Relaxed from 0.82 to 0.75
          console.log(`    🔄 Duplicate detected: "${a.title.substring(0, 50)}..." (${(sim * 100).toFixed(1)}% similar)`);
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
    const t = (article.title + ' ' + article.description).toLowerCase();
    ['executive order', 'supreme court', 'federal', 'regulation', 'congress passes', 'senate votes', 'bill signed', 'new rule'].forEach(k => {
      if (t.includes(k)) s += 10;
    });
    ['policy', 'law', 'court', 'judge', 'ruling', 'decision', 'congress', 'senate', 'house', 'governor', 'legislature'].forEach(k => {
      if (t.includes(k)) s += 5;
    });
    ['golf', 'sports', 'celebrity', 'entertainment', 'music', 'movie'].forEach(k => {
      if (t.includes(k)) s -= 15;
    });
    if (article.publishedAt) {
      const hrs = (Date.now() - new Date(article.publishedAt)) / 3600000;
      if (hrs < 24) s += 5;
      if (hrs < 12) s += 3;
    }
    const qs = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post', 'los angeles times'];
    if (qs.some(src => article.source?.name?.toLowerCase().includes(src))) s += 3;
    return Math.max(0, s);
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
        featured_headline: articles.find(a => a.status === 'published')?.title || 'Policy Updates'
      })
      .select()
      .single();
    if (e1) throw e1;

    // Save ALL articles, not just published ones
    const rows = articles.map(a => ({
      edition_id: edition.id,
      article_order: a.order || null,
      title: a.title,
      description: a.description,
      url: a.url,
      image_url: a.urlToImage || a.image,
      source_name: a.source?.name,
      published_at: a.publishedAt,
      analysis_text: a.analysis,
      analysis_generated_at: a.analysis_generated_at,
      analysis_word_count: a.analysis_word_count || 0,
      article_status: a.status,  // Add status field
      article_score: a.score || 0  // Add score field
    }));

    const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
    if (e2) throw e2;

    console.log(`✅ Created edition #${issue} with ${articles.length} total articles:`);
    console.log(`  - ${articles.filter(a => a.status === 'published').length} published`);
    console.log(`  - ${articles.filter(a => a.status === 'draft').length} drafts`);
    console.log(`  - ${articles.filter(a => a.status === 'queue').length} queued`);
    console.log(`  - ${articles.filter(a => a.status === 'rejected').length} rejected`);

    return edition;
  }

  async publishToWebsite(editionId) {
    const { error } = await supabase
      .from('daily_editions')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', editionId);
    if (error) throw error;
  }

  async markNewsletterSent(editionId) {
    try {
      await supabase.from('daily_editions').update({ status: 'sent' }).eq('id', editionId);
    } catch {}
  }

  async findEdition(date) {
    const { data, error } = await supabase.from('daily_editions').select('*').eq('edition_date', date).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
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
