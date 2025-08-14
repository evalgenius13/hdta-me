import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const REQUIRED_HEADINGS = [
  'How this affects the main group',
  'Ripple effects on others',
  'Winners and losers',
  "What's not being said",
  'The bigger picture',
  'Why everyone should care'
];

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
    allArticles = allArticles.filter(article => article?.title && article?.description);

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
          console.log(`  🔄 Using fallback for article ${i + 1}`);
          analysis = this.fallback();
        }
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

  async generateHumanImpactAnalysis(article) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';
    const cleanTitle = (article.title || '').replace(/[^\w\s\-.,!?]/g, '').substring(0, 200);
    const cleanDescription = (article.description || '').replace(/[^\w\s\-.,!?]/g, '').substring(0, 500);
    const cleanSource = (source || '').replace(/[^\w\s]/g, '').substring(0, 50);

    // STRICT PROMPT
    const prompt = `
Write a plain-English analysis in six sections, always in this order, using the following exact headings (start each section with the heading as a Markdown H2, e.g. ## How this affects the main group):

## How this affects the main group
[Describe everyday effects, feelings, and what people are actually dealing with]

## Ripple effects on others
[Explain how this hits families, communities, and other people]

## Winners and losers
[Who comes out ahead, who gets hurt?]

## What's not being said
[Important stuff that's missing from the coverage]

## The bigger picture
[Why this fits into larger trends or political moves]

## Why everyone should care
[Connect this to all readers - precedent, values, or broader impact]

Each section should be 2-4 sentences. Do not use bullet points or numbered lists. Do not skip any section. Do not shuffle or change the headings. Do not add extra sections.

Story: "${cleanTitle}"
Details: "${cleanDescription}"
Source: "${cleanSource}"
Date: "${pubDate}"
`.trim();

    try {
      const requestBody = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are great at explaining news in simple, conversational language. Write like you are talking to a friend over coffee.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600,
        temperature: 0.4
      };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
      if (!content) {
        throw new Error('OpenAI returned empty content');
      }
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
    if (wc < 120 || wc > 400) {
      this.logFallbackUsage('word_count', `${wc} words (need 120-400)`);
      return null;
    }

    // Check for bullet points or numbered lists
    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) {
      this.logFallbackUsage('formatting', 'bullet points/numbered lists detected');
      return null;
    }

    // Enforce headings and order
    const headingRegex = /^## (.+)$/gm;
    const foundHeadings = [];
    let match;
    while ((match = headingRegex.exec(normalized)) !== null) {
      foundHeadings.push(match[1].trim());
    }
    if (foundHeadings.length !== REQUIRED_HEADINGS.length ||
      !REQUIRED_HEADINGS.every((h, i) => foundHeadings[i] === h)) {
      this.logFallbackUsage('headings', `Headings missing or out of order: found=[${foundHeadings.join(', ')}]`);
      return null;
    }

    console.log(`  ✅ Sanitize passed: ${wc} words, headings OK, format OK`);
    return normalized;
  }

  fallback() {
    this.logFallbackUsage('generation_failed', 'AI generation or sanitization failed');
    return [
      '## How this affects the main group',
      'The concrete impact of this policy remains unclear due to ongoing negotiations. People affected may face new paperwork, eligibility changes, and delays in accessing benefits.',
      '',
      '## Ripple effects on others',
      'Families and communities could experience uncertainty as local organizations and support systems adjust to new requirements. The ripple effect may reach schools, healthcare providers, and social service agencies.',
      '',
      '## Winners and losers',
      'Individuals with strong legal or financial resources are likely to benefit, while those lacking access may struggle. Established organizations are often favored over newcomers.',
      '',
      "## What's not being said",
      'Hidden costs such as administrative delays or unexpected exclusions may not be fully covered in public discussions.',
      '',
      '## The bigger picture',
      'This policy fits into a broader trend of regulatory changes that can shift market dynamics over the next year.',
      '',
      '## Why everyone should care',
      'Even those not directly impacted may be affected by precedent and shifting community norms. Watch for further guidance in the coming months.'
    ].join('\n');
  }

  queueFallback() {
    return [
      '## How this affects the main group',
      'This story is in the queue for detailed analysis. The human impact assessment will explore how this affects individuals, families, and communities once the full analysis is completed.',
      '',
      '## Ripple effects on others',
      '',
      '## Winners and losers',
      '',
      "## What's not being said",
      '',
      '## The bigger picture',
      '',
      '## Why everyone should care',
      ''
    ].join('\n');
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

  logFallbackUsage(reason, details) {
    const timestamp = new Date().toISOString();
    console.log(`🔄 FALLBACK USED: ${reason} - ${details} at ${timestamp}`);
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
