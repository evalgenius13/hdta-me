// lib/trend-tracker.js - Real trend tracking based on analyzed articles
class RealTrendTracker {
  constructor() {
    // In-memory storage for demo - use Redis/database in production
    this.policies = [];
    this.maxPolicies = 1000; // Keep last 1000 analyzed articles
  }

  // Track a newly analyzed article
  trackAnalysis(article, analysis) {
    const policy = {
      id: Date.now() + Math.random(),
      date: new Date(),
      title: article.title,
      description: article.description,
      category: this.detectCategory(article),
      beneficiaries: this.extractBeneficiaries(analysis),
      negativelyAffected: this.extractNegativelyAffected(analysis),
      reversalType: this.detectReversal(article),
      analysis: analysis
    };

    this.policies.unshift(policy); // Add to beginning
    
    // Keep only recent policies
    if (this.policies.length > this.maxPolicies) {
      this.policies = this.policies.slice(0, this.maxPolicies);
    }

    return policy;
  }

  // Generate real trend context based on actual analyzed articles
  generateTrendContext(article) {
    const category = this.detectCategory(article);
    const context = [];

    // Count similar recent articles
    const recentSimilar = this.getRecentByCategory(category, 30); // Last 30 days
    if (recentSimilar.length > 1) {
      context.push(`This is the ${recentSimilar.length}${this.getOrdinalSuffix(recentSimilar.length)} ${category} story analyzed this month`);
    }

    // Find recurring beneficiaries
    const topBeneficiaries = this.getTopBeneficiaries(category, 60); // Last 60 days
    if (topBeneficiaries.length > 0) {
      context.push(`${topBeneficiaries[0]} has appeared as a beneficiary in multiple recent ${category} analyses`);
    }

    // Check for reversal patterns
    const reversals = this.getRecentReversals(30);
    if (reversals.length > 2) {
      context.push(`This continues a pattern of policy reversals - ${reversals.length} analyzed stories this month involved overturning previous policies`);
    }

    // Velocity analysis
    const velocity = this.calculateVelocity(category);
    if (velocity.perWeek > 1) {
      context.push(`The pace of ${category} policy changes has accelerated - averaging ${velocity.perWeek.toFixed(1)} stories per week`);
    }

    return context.length > 0 ? context.join('. ') + '.' : '';
  }

  // Get articles by category within days
  getRecentByCategory(category, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return this.policies.filter(p => 
      p.category === category && p.date >= cutoff
    );
  }

  // Find most mentioned beneficiaries in a category
  getTopBeneficiaries(category, days) {
    const recent = this.getRecentByCategory(category, days);
    const beneficiaryCount = {};

    recent.forEach(policy => {
      policy.beneficiaries.forEach(beneficiary => {
        beneficiaryCount[beneficiary] = (beneficiaryCount[beneficiary] || 0) + 1;
      });
    });

    return Object.entries(beneficiaryCount)
      .sort(([,a], [,b]) => b - a)
      .filter(([, count]) => count > 1)
      .map(([beneficiary]) => beneficiary);
  }

  // Get recent policy reversals
  getRecentReversals(days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return this.policies.filter(p => 
      p.reversalType && p.date >= cutoff
    );
  }

  // Calculate policy velocity for category
  calculateVelocity(category) {
    const recent = this.getRecentByCategory(category, 28); // 4 weeks
    const perWeek = recent.length / 4;
    
    const older = this.policies.filter(p => {
      const weeksBefore = new Date();
      weeksBefore.setDate(weeksBefore.getDate() - 56);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 28);
      
      return p.category === category && p.date >= weeksBefore && p.date < cutoff;
    });
    
    const previousPerWeek = older.length / 4;
    
    return {
      perWeek,
      change: perWeek - previousPerWeek,
      increasing: perWeek > previousPerWeek
    };
  }

  // Answer trend questions based on real data
  answerTrendQuestion(question, category) {
    const lowerQuestion = question.toLowerCase();

    if (lowerQuestion.includes('how many') || lowerQuestion.includes('count')) {
      return this.getCountResponse(category);
    } else if (lowerQuestion.includes('pattern') || lowerQuestion.includes('trend')) {
      return this.getPatternResponse(category);
    } else if (lowerQuestion.includes('benefi') || lowerQuestion.includes('winner')) {
      return this.getBeneficiaryResponse(category);
    } else if (lowerQuestion.includes('pace') || lowerQuestion.includes('speed')) {
      return this.getVelocityResponse(category);
    } else {
      return this.getGeneralResponse(category);
    }
  }

  getCountResponse(category) {
    const recent30 = this.getRecentByCategory(category, 30);
    const recent7 = this.getRecentByCategory(category, 7);
    
    if (recent30.length === 0) {
      return "I haven't analyzed any similar stories recently.";
    }
    
    return `I've analyzed ${recent30.length} ${category} stories in the past month, with ${recent7.length} just this week.`;
  }

  getPatternResponse(category) {
    const topBeneficiaries = this.getTopBeneficiaries(category, 60);
    const reversals = this.getRecentReversals(30).filter(p => p.category === category);
    
    if (topBeneficiaries.length === 0 && reversals.length === 0) {
      return "I don't have enough data to identify clear patterns yet.";
    }
    
    let response = '';
    
    if (topBeneficiaries.length > 0) {
      response += `Based on analyzed stories, ${topBeneficiaries.slice(0, 2).join(' and ')} consistently appear as beneficiaries of ${category} policy changes. `;
    }
    
    if (reversals.length > 0) {
      response += `${reversals.length} of the recent ${category} stories involved reversing previous policies.`;
    }
    
    return response;
  }

  getBeneficiaryResponse(category) {
    const topBeneficiaries = this.getTopBeneficiaries(category, 60);
    
    if (topBeneficiaries.length === 0) {
      return "I haven't identified clear beneficiary patterns in analyzed stories yet.";
    }
    
    return `Based on analyzed stories, the most frequently mentioned beneficiaries of ${category} policies have been ${topBeneficiaries.slice(0, 3).join(', ')}.`;
  }

  getVelocityResponse(category) {
    const velocity = this.calculateVelocity(category);
    
    if (velocity.perWeek < 0.5) {
      return `${category} stories are being analyzed slowly - less than one per week recently.`;
    } else if (velocity.increasing && velocity.change > 0.5) {
      return `The pace of ${category} story analysis is increasing - now ${velocity.perWeek.toFixed(1)} per week, up from before.`;
    } else {
      return `I'm seeing about ${velocity.perWeek.toFixed(1)} ${category} stories per week recently.`;
    }
  }

  getGeneralResponse(category) {
    const recent = this.getRecentByCategory(category, 30);
    
    if (recent.length === 0) {
      return "I don't have enough analyzed stories to identify trends in this area yet.";
    }
    
    if (recent.length < 3) {
      return `I've only analyzed ${recent.length} ${category} stories recently, so trends aren't clear yet.`;
    }
    
    return `Based on ${recent.length} analyzed stories, I can see some patterns emerging in ${category} policies.`;
  }

  // Helper methods for categorization and extraction
  detectCategory(article) {
    const text = (article.title + ' ' + article.description).toLowerCase();
    
    const categories = {
      'environmental': ['epa', 'climate', 'emission', 'green', 'renewable', 'pollution', 'carbon', 'environment'],
      'immigration': ['border', 'deportation', 'visa', 'asylum', 'ice', 'immigrant', 'migration'],
      'healthcare': ['medicare', 'medicaid', 'aca', 'insurance', 'drug', 'hospital', 'health'],
      'financial': ['bank', 'regulation', 'sec', 'crypto', 'finance', 'trading', 'wall street'],
      'energy': ['oil', 'gas', 'pipeline', 'drilling', 'fracking', 'energy', 'coal'],
      'tech': ['social media', 'algorithm', 'ai', 'data', 'privacy', 'tech', 'platform'],
      'trade': ['tariff', 'import', 'export', 'china', 'trade', 'wto', 'commerce'],
      'education': ['school', 'university', 'student', 'education', 'teacher', 'college']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return category;
      }
    }
    
    return 'policy';
  }

  extractBeneficiaries(analysis) {
    const beneficiaries = [];
    const text = analysis.toLowerCase();
    
    const beneficiaryTerms = [
      'oil companies', 'gas companies', 'energy companies', 'fossil fuel',
      'banks', 'wall street', 'financial firms', 'crypto',
      'insurance companies', 'pharma', 'pharmaceutical',
      'private prisons', 'defense contractors', 'tech companies',
      'manufacturers', 'corporations', 'industry'
    ];
    
    beneficiaryTerms.forEach(term => {
      if (text.includes(term)) {
        beneficiaries.push(term);
      }
    });
    
    return [...new Set(beneficiaries)]; // Remove duplicates
  }

  extractNegativelyAffected(analysis) {
    const affected = [];
    const text = analysis.toLowerCase();
    
    const affectedTerms = [
      'consumers', 'workers', 'families', 'patients', 'students',
      'immigrants', 'low-income', 'elderly', 'children',
      'environmental groups', 'unions', 'advocacy groups'
    ];
    
    affectedTerms.forEach(term => {
      if (text.includes(term)) {
        affected.push(term);
      }
    });
    
    return [...new Set(affected)];
  }

  detectReversal(article) {
    const text = (article.title + ' ' + article.description).toLowerCase();
    const reversalKeywords = ['reverses', 'overturns', 'cancels', 'ends', 'eliminates', 'rescinds', 'rolls back'];
    
    if (reversalKeywords.some(keyword => text.includes(keyword))) {
      if (text.includes('biden')) return 'Biden-era';
      if (text.includes('obama')) return 'Obama-era';
      return 'previous administration';
    }
    
    return null;
  }

  getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j == 1 && k != 11) return 'st';
    if (j == 2 && k != 12) return 'nd';
    if (j == 3 && k != 13) return 'rd';
    return 'th';
  }
}

// Export singleton instance
export const trendTracker = new RealTrendTracker();
