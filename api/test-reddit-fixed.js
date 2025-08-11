// Enhanced strategy: Better filtering + multiple news sources instead of Reddit
// This builds on your existing working GNews pipeline

class EnhancedNewsScanner {
  constructor() {
    this.gnewsKey = process.env.GNEWS_API_KEY;
    this.maxArticles = 6;
  }

  async getTrendingPolicyStories() {
    // Use multiple targeted searches instead of one broad search
    const searches = [
      // Government actions
      'congress passes OR senate votes OR "bill signed" OR "executive order"',
      
      // Court decisions  
      '"supreme court" OR "federal court" OR "court rules" OR "court decision"',
      
      // Regulatory changes
      'regulation OR "new rule" OR "policy change" OR "federal agency"',
      
      // State/local government
      'governor OR "state legislature" OR "city council" OR "ballot measure"'
    ];

    const allArticles = [];
    
    for (const query of searches) {
      try {
        const articles = await this.searchGNews(query);
        allArticles.push(...articles);
        
        // Add delay to avoid rate limiting
        await this.sleep(500);
      } catch (error) {
        console.warn('Search failed:', query, error.message);
      }
    }

    // Enhanced filtering and ranking
    const filtered = this.enhancedFilter(allArticles);
    const deduped = this.smartDedupe(filtered);
    const scored = this.scoreByRelevance(deduped);
    
    return scored.slice(0, this.maxArticles);
  }

  async searchGNews(query) {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=10&token=${this.gnewsKey}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GNews API error: ${response.status}`);
    
    const data = await response.json();
    return data.articles || [];
  }

  enhancedFilter(articles) {
    return articles.filter(article => {
      if (!article.title || !article.description) return false;
      
      const text = (article.title + ' ' + article.description).toLowerCase();
      
      // Must have clear policy relevance
      const policyIndicators = [
        // Government action verbs
        'passes', 'signs', 'approves', 'votes', 'rules', 'decides', 'announces',
        'implements', 'proposes', 'introduces', 'rejects', 'overturns',
        
        // Policy areas that affect individuals
        'tax', 'healthcare', 'immigration', 'housing', 'education', 'medicare',
        'social security', 'minimum wage', 'unemployment', 'climate policy',
        
        // Government entities
        'congress', 'senate', 'house', 'supreme court', 'federal court',
        'governor', 'legislature', 'agency', 'department'
      ];
      
      const hasPolicyRelevance = policyIndicators.some(indicator => 
        text.includes(indicator)
      );
      
      // Enhanced exclusions
      const exclusions = [
        'sports', 'nfl', 'nba', 'mlb', 'nhl', 'olympics', 'soccer',
        'celebrity', 'entertainment', 'music', 'movie', 'tv show',
        'gaming', 'video game', 'crypto', 'bitcoin', 'stock price',
        'earnings report', 'quarterly results'
      ];
      
      const hasExclusions = exclusions.some(exclusion => 
        text.includes(exclusion)
      );
      
      // Quality checks
      const isRecent = this.isRecentEnough(article.publishedAt);
      const isQualitySource = this.isQualitySource(article.source?.name);
      
      return hasPolicyRelevance && !hasExclusions && isRecent && isQualitySource;
    });
  }

  smartDedupe(articles) {
    const seen = new Map();
