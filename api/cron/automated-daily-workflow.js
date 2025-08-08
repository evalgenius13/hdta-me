import { createClient } from '@supabase/supabase-js';

// Initialize database connection
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

class AutomatedPublisher {
  constructor() {
    this.maxArticles = 6;
    this.qualityThreshold = 50; // Minimum word count for analysis
    this.startTime = Date.now();
  }

  async runFullWorkflow() {
    console.log('🚀 Starting fully automated daily workflow...');
    
    try {
      // 1. Curate and analyze articles
      const edition = await this.curateAndAnalyze();
      
      // 2. Auto-publish to website immediately
      await this.publishToWebsite(edition.id);
      
      // 3. Auto-send newsletter (can be delayed)
      await this.scheduleNewsletter(edition.id);
      
      // 4. Log success metrics
      await this.logWorkflowSuccess(edition);
      
      console.log(`✅ Fully automated workflow completed for Edition #${edition.issue_number}`);
      return edition;
      
    } catch (error) {
      console.error('❌ Automated workflow failed:', error);
      await this.handleWorkflowFailure(error);
      throw error;
    }
  }

  async curateAndAnalyze() {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if we already have today's edition
    const existingEdition = await this.checkExistingEdition(today);
    if (existingEdition) {
      console.log(`⚠️ Edition for ${today} already exists (Issue #${existingEdition.issue_number})`);
      return existingEdition;
    }

    // Fetch and score articles
    const articles = await this.fetchPolicyNews();
    const selectedArticles = await this.selectBestArticles(articles);
    
    console.log(`📰 Selected ${selectedArticles.length} articles for analysis`);

    // Generate analysis with quality checks
    const analyzedArticles = await this.generateAnalysisWithQualityChecks(selectedArticles);
    
    // Create edition and auto-publish
    const edition = await this.createEdition(today, analyzedArticles, 'published');
    
    return edition;
  }

  async generateAnalysisWithQualityChecks(articles) {
    const analyzed = [];
    
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      console.log(`🤖 Analyzing ${i + 1}/${articles.length}: ${article.title.substring(0, 50)}...`);
      
      let analysis = null;
      let attempts = 0;
      const maxAttempts = 2;
      
      while (!analysis && attempts < maxAttempts) {
        try {
          const rawAnalysis = await this.generateSingleAnalysis(article);
          
          // Quality check the analysis
          if (this.isAnalysisGoodQuality(rawAnalysis)) {
            analysis = rawAnalysis;
          } else {
            console.log(`⚠️ Poor quality analysis, retrying... (attempt ${attempts + 1})`);
            attempts++;
            if (attempts < maxAttempts) {
              await this.sleep(2000); // Wait longer before retry
            }
          }
          
        } catch (error) {
          console.error(`Analysis attempt ${attempts + 1} failed:`, error);
          attempts++;
          
          if (attempts < maxAttempts) {
            await this.sleep(3000);
          }
        }
      }
      
      // Fallback if all attempts failed
      if (!analysis) {
        analysis = this.generateFallbackAnalysis(article);
        console.log(`🔄 Using fallback analysis for: ${article.title}`);
      }
      
      analyzed.push({
        ...article,
        analysis: analysis,
        order: i + 1,
        analysis_generated_at: new Date().toISOString(),
        quality_score: this.calculateAnalysisQuality(analysis)
      });

      // Rate limiting - wait 1.5 seconds between calls
      if (i < articles.length - 1) {
        await this.sleep(1500);
      }
    }

    return analyzed;
  }

  isAnalysisGoodQuality(analysis) {
    if (!analysis || typeof analysis !== 'string') return false;
    
    // Minimum length check
    if (analysis.length < this.qualityThreshold) return false;
    
    // Check for common AI failure patterns
    const badPatterns = [
      'i cannot',
      'i\'m sorry',
      'as an ai',
      'i don\'t have access',
      'analysis not available',
      'unable to analyze'
    ];
    
    const lowerAnalysis = analysis.toLowerCase();
    if (badPatterns.some(pattern => lowerAnalysis.includes(pattern))) {
      return false;
    }
    
    // Check for policy-relevant content
    const goodIndicators = [
      'impact',
      'affect',
      'people',
      'cost',
      'benefit',
      'change',
      'policy',
      'government'
    ];
    
    const hasRelevantContent = goodIndicators.some(indicator => 
      lowerAnalysis.includes(indicator)
    );
    
    return hasRelevantContent;
  }

  calculateAnalysisQuality(analysis) {
    let score = 0;
    
    // Length scoring
    const wordCount = analysis.split(' ').length;
    if (wordCount >= 50) score += 20;
    if (wordCount >= 100) score += 20;
    if (wordCount <= 200) score += 10; // Not too long
    
    // Content quality indicators
    const qualityIndicators = [
      'bigger picture', 'real impact', 'what this means',
      'daily lives', 'costs', 'benefits', 'timeline',
      'who gets hurt', 'while officials', 'the reality'
    ];
    
    qualityIndicators.forEach(indicator => {
      if (analysis.toLowerCase().includes(indicator)) score += 5;
    });
    
    return Math.min(100, score);
  }

  generateFallbackAnalysis(article) {
    // Simple template-based fallback when AI fails
    const templates = [
      `This policy change will likely affect how government agencies operate and could impact various groups differently. The full implications may become clearer as implementation details emerge. Citizens should monitor how this develops and consider reaching out to representatives with concerns.`,
      
      `While officials focus on the political aspects, the real-world impact of this policy may take time to understand fully. Different communities could see varying effects depending on their circumstances. It's worth watching how this policy gets implemented in practice.`,
      
      `This development represents a shift in policy direction that could influence various sectors. The broader implications for individuals and businesses may become apparent as more details are released. Staying informed about implementation timelines will be important.`
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async publishToWebsite(editionId) {
    console.log('🌐 Auto-publishing to website...');
    
    // Update edition status to published
    const { error } = await supabase
      .from('daily_editions')
      .update({ 
        status: 'published',
        updated_at: new Date().toISOString()
      })
      .eq('id', editionId);
    
    if (error) throw error;
    
    console.log('✅ Website published successfully');
  }

  async scheduleNewsletter(editionId) {
    console.log('📧 Scheduling newsletter send...');
    
    try {
      // Get subscriber count for logging
      const { count } = await supabase
        .from('newsletter_subscribers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      console.log(`📊 Will send to ${count || 0} active subscribers`);
      
      // For now, just log that we would send
      // TODO: Implement actual email sending
      console.log('📧 Newsletter send scheduled (implementation pending)');
      
      // Update edition status
      await supabase
        .from('daily_editions')
        .update({ status: 'sent' })
        .eq('id', editionId);
        
    } catch (error) {
      console.error('Newsletter scheduling failed:', error);
      // Don't throw - website is still published
    }
  }

  async logWorkflowSuccess(edition) {
    const duration = Math.floor((Date.now() - this.startTime) / 1000);
    
    console.log(`📊 Workflow completed in ${duration}s for Edition #${edition.issue_number}`);
    
    // Log to metrics table
    await supabase
      .from('curation_metrics')
      .insert({
        edition_id: edition.id,
        articles_fetched: 20, // Estimated
        articles_analyzed: this.maxArticles,
        total_processing_time_seconds: duration,
        openai_api_calls: this.maxArticles,
        estimated_cost_usd: this.maxArticles * 0.02
      });
  }

  async handleWorkflowFailure(error) {
    console.error('🚨 WORKFLOW FAILURE:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // Try to create a minimal fallback edition
    try {
      await this.createFallbackEdition(error);
    } catch (fallbackError) {
      console.error('Even fallback failed:', fallbackError);
    }
  }

  async createFallbackEdition(originalError) {
    console.log('🔄 Creating fallback edition...');
    
    const today = new Date().toISOString().split('T')[0];
    const { data: issueData } = await supabase.rpc('get_next_issue_number');
    const issueNumber = issueData || 1;
    
    // Create minimal edition
    const { data: edition } = await supabase
      .from('daily_editions')
      .insert({
        edition_date: today,
        issue_number: issueNumber,
        status: 'published',
        featured_headline: 'Daily Policy Analysis',
        editor_notes: `Automated workflow encountered an error: ${originalError.message}`
      })
      .select()
      .single();
    
    // Add a single fallback article
    await supabase
      .from('analyzed_articles')
      .insert({
        edition_id: edition.id,
        article_order: 1,
        title: 'Policy Analysis Temporarily Unavailable',
        description: 'We encountered a technical issue while preparing today\'s analysis. Please check back later for updated content.',
        url: 'https://hdta.me',
        source_name: 'HDTA.me',
        published_at: new Date().toISOString(),
        analysis_text: 'We\'re working to resolve a technical issue that prevented today\'s policy analysis from being generated. Our automated system will resume normal operation shortly. Thank you for your patience.',
        analysis_generated_at: new Date().toISOString()
      });
    
    console.log('✅ Fallback edition created');
  }

  // Utility methods
  async checkExistingEdition(date) {
    const { data, error } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', date)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    return data;
  }

  async fetchPolicyNews() {
    try {
      const API_KEY = process.env.GNEWS_API_KEY;
      const query = 'congress OR senate OR "executive order" OR regulation OR "supreme court"';
      
      const response = await fetch(
        `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=20&token=${API_KEY}`
      );
      
      const data = await response.json();
      return data.articles || [];
      
    } catch (error) {
      console.error('Failed to fetch news:', error);
      return [];
    }
  }

  async selectBestArticles(articles) {
    // Score articles based on policy impact potential
    const scoredArticles = articles.map(article => ({
      ...article,
      score: this.calculatePolicyScore(article)
    }));

    // Sort by score and take top articles
    const sorted = scoredArticles
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxArticles);

    return sorted;
  }

  calculatePolicyScore(article) {
    let score = 0;
    const text = (article.title + ' ' + article.description).toLowerCase();

    // High-impact keywords (worth more points)
    const highImpactKeywords = [
      'executive order', 'supreme court', 'federal', 'regulation',
      'congress passes', 'senate votes', 'bill signed', 'new rule'
    ];
    
    const mediumImpactKeywords = [
      'policy', 'law', 'court', 'judge', 'ruling', 'decision',
      'congress', 'senate', 'house', 'governor', 'legislature'
    ];

    const lowValueKeywords = [
      'golf', 'sports', 'celebrity', 'entertainment', 'music', 'movie'
    ];

    // Score based on keywords
    highImpactKeywords.forEach(keyword => {
      if (text.includes(keyword)) score += 10;
    });

    mediumImpactKeywords.forEach(keyword => {
      if (text.includes(keyword)) score += 5;
    });

    lowValueKeywords.forEach(keyword => {
      if (text.includes(keyword)) score -= 15;
    });

    // Bonus for recent articles
    if (article.publishedAt) {
      const hoursOld = (Date.now() - new Date(article.publishedAt)) / (1000 * 60 * 60);
      if (hoursOld < 24) score += 5;
      if (hoursOld < 12) score += 3;
    }

    // Bonus for good sources
    const qualitySources = ['reuters', 'ap news', 'bloomberg', 'wall street journal', 'washington post'];
    if (qualitySources.some(source => article.source?.name?.toLowerCase().includes(source))) {
      score += 3;
    }

    return Math.max(0, score);
  }

  async generateSingleAnalysis(article) {
    const prompt = `You're analyzing a policy change to show the bigger picture of how it affects real people's daily lives.

Policy: "${article.title}"
Details: "${article.description}"

Write a clear analysis that reveals what news articles typically miss - the concrete impact on regular people. Focus on:
1. What this actually means for people's daily lives (specific costs, changes, timeline)
2. Who gets hurt most and who benefits (be specific about groups of people)
3. The bigger pattern - how this connects to other recent changes affecting the same people
4. What officials aren't emphasizing about the real-world consequences

Use plain English. Be factual and specific about impacts. Avoid jargon. Show the human side of policy changes.
Keep it under 200 words. Write like a journalist who's done the research to connect the dots.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You explain government policies in simple terms. You focus on who wins and who loses from policy changes. You write like you\'re talking to a friend, using everyday language that anyone can understand.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 220,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  }

  async createEdition(date, articles, status = 'published') {
    // Get next issue number
    const { data: issueData } = await supabase.rpc('get_next_issue_number');
    const issueNumber = issueData || 1;

    // Create edition record
    const { data: edition, error: editionError } = await supabase
      .from('daily_editions')
      .insert({
        edition_date: date,
        issue_number: issueNumber,
        status: status,
        featured_headline: articles[0]?.title || 'Policy Updates'
      })
      .select()
      .single();

    if (editionError) throw editionError;

    // Insert analyzed articles
    const articlesData = articles.map(article => ({
      edition_id: edition.id,
      article_order: article.order,
      title: article.title,
      description: article.description,
      url: article.url,
      image_url: article.urlToImage || article.image,
      source_name: article.source?.name,
      published_at: article.publishedAt,
      analysis_text: article.analysis,
      analysis_generated_at: article.analysis_generated_at,
      analysis_word_count: article.analysis.split(' ').length
    }));

    const { error: articlesError } = await supabase
      .from('analyzed_articles')
      .insert(articlesData);

    if (articlesError) throw articlesError;

    return edition;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main export for cron job
export async function runAutomatedWorkflow() {
  const publisher = new AutomatedPublisher();
  return await publisher.runFullWorkflow();
}
