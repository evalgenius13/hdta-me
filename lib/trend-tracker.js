// lib/trend-tracker.js - Redis-backed trend tracking
import { Redis } from '@upstash/redis';

class RedisTrendTracker {
  constructor() {
    this.redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    this.maxPolicies = 1000; // Keep last 1000 analyzed articles
  }

  // Track a newly analyzed article
  async trackAnalysis(article, analysis) {
    const policy = {
      id: Date.now() + Math.random(),
      date: new Date().toISOString(),
      title: article.title,
      description: article.description,
      category: this.detectCategory(article),
      beneficiaries: this.extractBeneficiaries(analysis),
      negativelyAffected: this.extractNegativelyAffected(analysis),
      reversalType: this.detectReversal(article),
      analysis: analysis
    };

    try {
      // Add to the beginning of the list
      await this.redis.lpush('policies', JSON.stringify(policy));
      
      // Keep only recent policies
      await this.redis.ltrim('policies', 0, this.maxPolicies - 1);
      
      return policy;
    } catch (error) {
      console.error('Error tracking policy:', error);
      return policy;
    }
  }

  // Get all policies from Redis with error handling
  async getAllPolicies() {
    try {
      const policies = await this.redis.lrange('policies', 0, -1);
      return policies.map(p => {
        try {
          return JSON.parse(p);
        } catch (parseError) {
          console.error('Error parsing policy:', parseError);
          return null;
        }
      }).filter(p => p !== null);
    } catch (error) {
      console.error('Error getting policies from Redis:', error);
      return [];
    }
  }

  // Generate real trend context based on actual analyzed articles
  async generateTrendContext(article) {
    try {
      const category = this.detectCategory(article);
      const policies = await this.getAllPolicies();
      const context = [];

      // Count similar recent articles
      const recentSimilar = this.getRecentByCategory(policies, category, 30);
      if (recentSimilar.length > 1) {
        context.push(`This is the ${recentSimilar.length}${this.getOrdinalSuffix(recentSimilar.length)} ${category} story analyzed this month`);
      }

      // Find recurring beneficiaries
      const topBeneficiaries = this.getTopBeneficiaries(policies, category, 60);
      if (topBeneficiaries.length > 0) {
        context.push(`${topBeneficiaries[0]} has appeared as a beneficiary in multiple recent ${category} analyses`);
      }

      // Check for reversal patterns
      const reversals = this.getRecentReversals(policies, 30);
      if (reversals.length > 2) {
        context.push(`This continues a pattern of policy reversals - ${reversals.length} analyzed stories this month involved overturning previous policies`);
      }

      // Velocity analysis
      const velocity = this.calculateVelocity(policies, category);
      if (velocity.perWeek > 1) {
        context.push(`The pace of ${category} policy changes has accelerated - averaging ${velocity.perWeek.toFixed(1)} stories per week`);
      }

      return context.length > 0 ? context.join('. ') + '.' : '';
    } catch (error) {
      console.error('Error generating trend context:', error);
      return '';
    }
  }

  // Get articles by category within days
  getRecentByCategory(policies, category, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return policies.filter(p => {
      const policyDate = new Date(p.date);
      return p.category === category && policyDate >= cutoff;
    });
  }

  // Find most mentioned beneficiaries in a category
  getTopBeneficiaries(policies, category, days) {
    const recent = this.getRecentByCategory(policies, category, days);
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
  getRecentReversals(policies, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return policies.filter(p => {
      const policyDate = new Date(p.date);
      return p.reversalType && policyDate >= cutoff;
    });
  }

  // Calculate policy velocity for category
  calculateVelocity(policies, category) {
    const recent = this.getRecentByCategory(policies, category, 28); // 4 weeks
    const perWeek = recent.length / 4;
    
    const weeksBefore = new Date();
    weeksBefore.setDate(weeksBefore.getDate() - 56);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    
    const older = policies.filter(p => {
      const policyDate = new Date(p.date);
      return p.category === category && policyDate >= weeksBefore && policyDate < cutoff;
    });
    
    const previousPerWeek = older.length / 4;
    
    return {
      perWeek,
      change: perWeek - previousPerWeek,
      increasing: perWeek > previousPerWeek
    };
  }

  // Answer trend questions based on real data
  async answerTrendQuestion(question, category) {
    try {
      const policies = await this.getAllPolicies();
      const lowerQuestion = question.toLowerCase();

      if (lowerQuestion.includes('how many') || lowerQuestion.includes('count')) {
        return this.getCountResponse(policies, category);
      } else if (lowerQuestion.includes('pattern') || lowerQuestion.includes('trend')) {
        return this.getPatternResponse(policies, category);
      } else if (lowerQuestion.includes('benefi') || lowerQuestion.includes('winner')) {
        return this.getBeneficiaryResponse(policies, category);
      } else if (lowerQuestion.includes('pace') || lowerQuestion.includes('speed')) {
        return this.getVelocityResponse(policies, category);
      } else {
        return this.getGeneralResponse(policies, category);
      }
    } catch (error) {
      console.error('Error answering trend question:', error);
      return "I'm having trouble accessing the trend data right now.";
    }
  }

  getCountResponse(policies, category) {
    const recent30 = this.getRecentByCategory(policies, category, 30);
    const recent7 = this.getRecentByCategory(policies, category, 7);
    
    if (recent30.length === 0) {
      return "I haven't analyzed any similar stories recently.";
    }
    
    return `I've analyzed ${recent30.length} ${category} stories in the past month, with ${recent7.length} just this week.`;
  }

  getPatternResponse(policies, category) {
    const topBeneficiaries = this.getTopBeneficiaries(policies, category, 60);
    const reversals = this.getRecentReversals(policies, 30).filter(p => p.category === category);
    
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

  getBeneficiaryResponse(policies, category) {
    const topBeneficiaries = this.getTopBeneficiaries(policies, category, 60);
    
    if (topBeneficiaries.length === 0) {
      return "I haven't identified clear beneficiary patterns in analyzed stories yet.";
    }
    
    return `Based on analyzed stories, the most frequently mentioned beneficiaries of ${category} policies have been ${topBeneficiaries.slice(0, 3).join(', ')}.`;
  }

  getVelocityResponse(policies, category) {
    const velocity = this.calculateVelocity(policies, category);
    
    if (velocity.perWeek < 0.5) {
      return `${category} stories are being analyzed slowly - less than one per week recently.`;
    } else if (velocity.increasing && velocity.change > 0.5) {
      return `The pace of ${category} story analysis is increasing - now ${velocity.perWeek.toFixed(1)} per week, up from before.`;
    } else {
      return `I'm seeing about ${velocity.perWeek.toFixed(1)} ${category} stories per week recently.`;
    }
  }

  getGeneralResponse(policies, category) {
    const recent = this.getRecentByCategory(policies, category, 30);
    
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
export const trendTracker = new RedisTrendTracker();
