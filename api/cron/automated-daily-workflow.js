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
    // Temporarily bypass selectBest to see if that's filtering out articles
    const selected = articles.slice(0, this.maxArticles); // Just take first 6
    const analyzed = await this.analyzeAll(selected);
    const edition = await this.createEdition(today, analyzed, 'published');
    return edition;
  }

  async analyzeAll(articles) {
    const out = [];
    for (let i = 0; i < Math.min(articles.length, this.maxArticles); i++) {
      const a = articles[i];
      let analysis = null;

      // PHASE 2: Extract full article content
      let fullContent = null;
      try {
        console.log(`Extracting content for: ${a.title.substring(0, 50)}...`);
        fullContent = await this.extractArticleContent(a.url);
      } catch (error) {
        console.warn(`Content extraction failed for ${a.url}:`, error.message);
      }

      for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
        const raw = await this.generateNarrative(a, fullContent).catch(() => null);
        const cleaned = raw ? this.sanitize(a, raw) : null;
        if (cleaned) analysis = this.applyEthics(cleaned);
        if (!analysis) await this.sleep(1200);
      }

      if (!analysis) analysis = this.applyEthics(this.fallback());

      out.push({
        ...a,
        order: i + 1,
        analysis,
        analysis_generated_at: new Date().toISOString(),
        analysis_word_count: analysis.split(/\s+/).filter(Boolean).length,
        content_extracted: !!fullContent,
        content_method: fullContent?.extractionMethod || 'none'
      });
    }
    return out;
  }

  async generateNarrative(article, fullContent = null) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const pubDate = article.publishedAt || 'not stated';
    const source = article.source?.name || 'not stated';

    // Use full content if available, otherwise fall back to description
    const articleContent = fullContent?.content || article.description || '';
    const hasFullContent = !!fullContent;

    const prompt = `
Write exactly 140-170 words as a clear, scannable story in 4 paragraphs. Use plain, conversational English like explaining to a friend.

Paragraph 1 - THE HOOK (25-35 words): Start with the immediate, personal impact in one clear sentence. No jargon or policy-speak.

Paragraph 2 - THE DETAILS (40-50 words): Costs, timelines, eligibility requirements, deadlines. Be specific about dollar amounts and dates when available.

Paragraph 3 - WINNERS & LOSERS (40-50 words): Who comes out ahead and who it impacts hardest. Use specific demographics only when explicitly mentioned in the source article. Otherwise focus on roles like "homeowners," "small business owners," "renters."

Paragraph 4 - CONTEXT & NEXT (25-35 words): Brief historical context plus one thing to watch for next (fees, delays, eligibility changes).

Replace policy jargon with everyday words:
- "implementation" → "when it starts"
- "stakeholders" → "people affected"
- "regulatory framework" → "new rules"

Policy: "${article.title}"
${hasFullContent ? 'Full Article Content:' : 'Summary:'} "${articleContent}"
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
          { role: 'system', content: `Write clear, scannable policy analysis in plain English. Structure as 4 focused paragraphs. Be conversational but accurate. ${hasFullContent ? 'You have the full article content for detailed analysis.' : 'You have limited content, focus on the key impacts.'}` },
          { role: 'user', content: prompt }
        ],
        max_tokens: 260,
        temperature: 0.3
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
    if (wc < 110 || wc > 220) return null;

    if (/^\s*(?:-|\*|\d+\.)\s/m.test(normalized)) return null;

    const inputs = [article.title || '', article.description || '', article.publishedAt || '']
      .join(' ')
      .toLowerCase();
    const years = normalized.match(/\b(19|20)\d{2}\b/g) || [];
    for (const y of years) {
      if (!inputs.includes(String(y).toLowerCase())) return null;
    }

    return normalized;
  }

  applyEthics(text) {
    let out = text;
    const sensitive = [
      'less diversity',
      'reduced diversity',
      'more homogenous',
      'less representation',
      'exclusion',
      'discrimin',
      'disparate impact',
      'voter suppression',
      'gerrymander',
      'redlined',
      'segregat'
    ];
    out = out
      .split(/\n\n/)
      .map(par => {
        const sentences = par.split(/(?<=[.!?])\s+/);
        const fixed = sentences.map(s => {
          const hasBenefit = /\b(benefit|benefits|benefited|winners?)\b/i.test(s);
          const hasSensitive = sensitive.some(k => s.toLowerCase().includes(k));
          if (hasBenefit && hasSensitive) {
            return s
              .replace(/\b[Bb]enefit(?:s|ed)?\b/g, 'effect')
              .replace(/\bWinners?\b/g, 'Groups most advantaged by this change');
          }
          return s;
        });
        return fixed.join(' ');
      })
      .join('\n\n');
    return out;
  }

  fallback() {
    return 'For most readers, the impact depends on implementation. Costs, eligibility, timelines, and paperwork decide who benefits and who pays.\n\nPeople who move early and qualify cleanly tend to fare better. Those facing new fees or credit changes are more exposed. Similar decisions have shifted terms before, so outcomes can move.\n\nWatch agency guidance, caps, fixed charges, and processing delays. These details often matter more than the headline.';
  }

  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      if (!API_KEY) return [];

      // Calculate yesterday's date in YYYY-MM-DD format
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateString = yesterday.toISOString().split('T')[0];

      // Policy-specific query (broad and targeted)
      const query = `congress OR senate OR "bill signed" OR "supreme court" OR "executive order" OR "federal court" OR governor OR legislature OR regulation OR "new law" OR "policy change"`;

      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&from=${dateString}&to=${dateString}&lang=en&country=us&max=15&token=${API_KEY}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`GNews API error: ${response.status}`);

      const data = await response.json();
      const articles = Array.isArray(data.articles) ? data.articles : [];

      // Enhanced filtering for policy relevance
      const policyRelevant = articles.filter(article => {
        if (!article.title || !article.description) return false;

        const text = (article.title + ' ' + article.description).toLowerCase();

        // Strong policy indicators
        const strongPolicyTerms = [
          'congress passes', 'senate votes', 'bill signed', 'executive order',
          'supreme court', 'federal court', 'court rules', 'court decision',
          'new law', 'policy change', 'regulation', 'federal agency',
          'governor signs', 'legislature approves'
        ];

        // Personal impact policy areas - 2025 hot topics
        const impactAreas = [
          // HOUSING (🔥🔥🔥 - TOP IMPACT)
          'mortgage rates', 'housing', 'rent', 'home prices', 'housing affordability',
          'rental market', 'homebuying', 'real estate', 'eviction',
          
          // EDUCATION (🔥🔥🔥 - MAJOR POLICY SHIFT)
          'school vouchers', 'school choice', 'education savings accounts', 'private school',
          'public school funding', 'charter schools', 'education freedom',
          
          // ABORTION (🔥🔥🔥 - STATE BATTLES)
          'abortion', 'reproductive rights', 'fetal personhood', 'abortion pills',
          'emergency abortion care', 'roe v wade', 'pregnancy', 'reproductive health',
          
          // MENTAL HEALTH (🔥🔥🔥 - FUNDING CRISIS)
          'mental health', 'behavioral health', 'suicide prevention', 'addiction treatment',
          'mental health parity', 'substance abuse', 'crisis intervention',
          
          // CIVIL RIGHTS (🔥🔥 - ONGOING BATTLES)
          'civil rights', 'human rights', 'voting rights', 'discrimination', 'equal protection',
          'lgbtq rights', 'transgender', 'disability rights', 'religious freedom',
          
          // COST OF LIVING (🔥🔥 - DAILY IMPACT)
          'tariffs', 'inflation', 'food prices', 'gas prices', 'cost of living',
          'grocery prices', 'energy costs', 'minimum wage',
          
          // HEALTHCARE (🔥🔥 - ONGOING CRISIS)
          'healthcare', 'medicare', 'medicaid', 'prescription drugs', 'health insurance',
          'medical costs', 'obamacare', 'health coverage',
          
          // TAX POLICY (🔥 - WALLET IMPACT)
          'tax', 'income tax', 'tax cuts', 'deduction', 'tax policy', 'IRS',
          'child tax credit', 'earned income tax credit',
          
          // TRADITIONAL HIGH-IMPACT AREAS
          'social security', 'unemployment', 'immigration', 'student loans', 'climate'
        ];

        const hasStrongPolicy = strongPolicyTerms.some(term => text.includes(term));
        const hasPersonalImpact = impactAreas.some(area => text.includes(area));

        // Quality source check
        const qualitySources = [
          'reuters', 'ap news', 'associated press', 'bbc', 'cnn', 'npr',
          'washington post', 'new york times', 'wall street journal', 'bloomberg',
          'politico', 'axios', 'the hill', 'abc news', 'cbs news', 'nbc news'
        ];

        const isQualitySource = qualitySources.some(source =>
          (article.source?.name || '').toLowerCase().includes(source)
        );

        return (hasStrongPolicy || hasPersonalImpact) && isQualitySource;
      });

      // Score and rank by policy relevance
      const scoredArticles = policyRelevant.map(article => ({
        ...article,
        policyScore: this.calculatePolicyScore(article)
      }));

      // Return top articles (let selectBest handle final count)
      return scoredArticles
        .sort((a, b) => b.policyScore - a.policyScore);

    } catch (error) {
      console.error('Enhanced policy news fetch failed:', error);
      return [];
    }
  }

  calculatePolicyScore(article) {
    let score = 0;
    const text = (article.title + ' ' + article.description).toLowerCase();

    // High-impact government actions
    const highImpactTerms = [
      'supreme court', 'executive order', 'congress passes', 'senate votes',
      'bill signed', 'federal court', 'new law'
    ];
    highImpactTerms.forEach(term => {
      if (text.includes(term)) score += 10;
    });

    // 2025 Hot personal impact areas (weighted higher)
    const hotPersonalImpactTerms = [
      // Housing crisis
      'mortgage rates', 'housing affordability', 'rent prices', 'home prices',
      // Education revolution  
      'school vouchers', 'school choice', 'education savings',
      // Abortion battles
      'abortion', 'reproductive rights', 'fetal personhood',
      // Mental health crisis
      'mental health', 'behavioral health', 'suicide prevention',
      // Civil rights battles
      'civil rights', 'voting rights', 'lgbtq rights', 'transgender',
      // Cost of living
      'tariffs', 'inflation', 'food prices'
    ];
    hotPersonalImpactTerms.forEach(term => {
      if (text.includes(term)) score += 8;
    });

    // Traditional personal impact areas
    const personalImpactTerms = [
      'tax', 'healthcare', 'medicare', 'social security', 'immigration',
      'education', 'unemployment', 'minimum wage'
    ];
    personalImpactTerms.forEach(term => {
      if (text.includes(term)) score += 5;
    });

    // Source quality bonus
    const premiumSources = ['reuters', 'ap news', 'washington post', 'wall street journal'];
    if (premiumSources.some(source => (article.source?.name || '').toLowerCase().includes(source))) {
      score += 5;
    }

    // Official government sources bonus
    if (text.includes('.gov') || text.includes('white house') || text.includes('congress.gov')) {
      score += 3;
    }

    return score;
  }

  async selectBest(list) {
    const filtered = list.filter(
      a =>
        a?.title &&
        a?.description &&
        !/\b(golf|nba|nfl|ncaa|celebrity|entertainment|music|movie|earnings|stocks)\b/i.test(a.title)
    );
    const deduped = this.dedupe(filtered);
    return deduped
      .map(a => ({ ...a, score: this.score(a) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, this.maxArticles);
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
        if (sim > 0.82) {
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
    
    // Enhanced scoring for 2025 hot topics
    ['school vouchers', 'abortion', 'mental health', 'mortgage rates', 'tariffs'].forEach(k => {
      if (t.includes(k)) s += 15;
    });
    
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
        featured_headline: articles[0]?.title || 'Policy Updates'
      })
      .select()
      .single();
    if (e1) throw e1;

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
      analysis_word_count: a.analysis_word_count
    }));

    const { error: e2 } = await supabase.from('analyzed_articles').insert(rows);
    if (e2) throw e2;

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

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // PHASE 2: Article content extraction methods
  async extractArticleContent(url) {
    const timeout = 8000; // 8 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Try multiple extraction strategies
      const strategies = [
        () => this.extractViaReadability(url, controller.signal),
        () => this.extractViaMetaTags(url, controller.signal)
      ];

      for (const strategy of strategies) {
        try {
          const result = await strategy();
          if (result && result.content && result.content.length > 100) {
            clearTimeout(timeoutId);
            return result;
          }
        } catch (error) {
          console.warn('Extraction strategy failed:', error.message);
          continue;
        }
      }

      clearTimeout(timeoutId);
      return null; // Fall back to headline + description
    } catch (error) {
      console.warn('Content extraction failed:', error.message);
      clearTimeout(timeoutId);
      return null;
    }
  }

  async extractViaReadability(url, signal) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    return this.parseHTMLContent(html, url);
  }

  async extractViaMetaTags(url, signal) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'text/html'
      },
      signal: signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    
    const title = this.extractMetaTag(html, 'og:title') || 
                 this.extractMetaTag(html, 'title') ||
                 html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';

    const description = this.extractMetaTag(html, 'og:description') ||
                       this.extractMetaTag(html, 'description') || '';

    return {
      title: this.cleanHtmlText(title),
      content: this.cleanHtmlText(description),
      extractionMethod: 'meta_tags'
    };
  }

  parseHTMLContent(html, url) {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                      html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? this.cleanHtmlText(titleMatch[1]) : '';

    // Look for article content
    const contentPatterns = [
      /<article[^>]*>(.*?)<\/article>/is,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*story[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<main[^>]*>(.*?)<\/main>/is
    ];

    let rawContent = '';
    for (const pattern of contentPatterns) {
      const match = html.match(pattern);
      if (match) {
        rawContent = match[1];
        break;
      }
    }

    // Extract clean paragraphs
    const paragraphs = this.extractCleanParagraphs(rawContent);
    const content = paragraphs.join('\n\n');

    return {
      title: title,
      content: content,
      extractionMethod: 'readability',
      wordCount: content.split(/\s+/).length
    };
  }

  extractCleanParagraphs(html) {
    if (!html) return [];

    // Remove unwanted elements
    let cleaned = html
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
      .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
      .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
      .replace(/<!--.*?-->/gs, '');

    // Extract paragraphs
    const paragraphMatches = cleaned.match(/<p[^>]*>([^<]+(?:<[^p][^>]*>[^<]*<\/[^p][^>]*>[^<]*)*)<\/p>/gi) || [];
    
    return paragraphMatches
      .map(p => this.cleanHtmlText(p.replace(/<[^>]+>/g, ' ')))
      .filter(p => p.length > 50) // Filter short paragraphs
      .filter(p => !this.isBoilerplate(p))
      .slice(0, 8); // Take first 8 paragraphs
  }

  isBoilerplate(text) {
    const boilerplatePatterns = [
      /^(subscribe|sign up|follow us|share this)/i,
      /^(copyright|all rights reserved)/i,
      /^(advertisement|sponsored)/i,
      /(click here|read more)/i
    ];
    return boilerplatePatterns.some(pattern => pattern.test(text));
  }

  extractMetaTag(html, property) {
    const patterns = [
      new RegExp(`<meta[^>]+property="og:${property}"[^>]+content="([^"]+)"`, 'i'),
      new RegExp(`<meta[^>]+name="${property}"[^>]+content="([^"]+)"`, 'i')
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  cleanHtmlText(text) {
    if (!text) return '';
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export async function runAutomatedWorkflow() {
  const p = new AutomatedPublisher();
  return p.runFullWorkflow();
}
