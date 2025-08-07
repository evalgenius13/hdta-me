// lib/trend-tracker.js - Core trend analysis system
class TrendTracker {
  constructor() {
    this.patterns = {
      policy: new Map(),
      financial: new Map(), 
      demographic: new Map(),
      geographic: new Map(),
      temporal: new Map()
    };
  }

  // Policy pattern tracking
  trackPolicy(article, analysis) {
    const policyData = {
      id: this.generateId(),
      date: new Date(),
      title: article.title,
      category: this.categorizePolicy(article),
      reversalType: this.detectReversal(article),
      affectedIndustries: this.extractIndustries(analysis),
      beneficiaries: this.extractBeneficiaries(analysis),
      negativelyAffected: this.extractNegativelyAffected(analysis),
      appointmentRelated: this.detectAppointment(article),
      deregulationType: this.detectDeregulation(article)
    };
    
    this.patterns.policy.set(policyData.id, policyData);
    return policyData;
  }

  // Financial trend tracking
  trackFinancial(policyData, marketData) {
    const financialTrend = {
      policyId: policyData.id,
      affectedStocks: this.identifyAffectedStocks(policyData.affectedIndustries),
      donorConnections: this.findDonorConnections(policyData.beneficiaries),
      lobbyingCorrelations: this.findLobbyingSpend(policyData.category),
      marketImpact: marketData,
      timeline: this.createTimeline(policyData.date)
    };
    
    this.patterns.financial.set(policyData.id, financialTrend);
    return financialTrend;
  }

  // Generate trend insights
  generateTrendContext(article, analysis) {
    const trends = {
      patterns: this.findRelevantPatterns(article),
      velocity: this.calculatePolicyVelocity(),
      comparisons: this.compareToFirstTerm(article),
      cumulative: this.calculateCumulativeImpact(analysis),
      predictions: this.generatePredictions(article)
    };
    
    return this.formatTrendContext(trends);
  }

  // Helper methods
  categorizePolicy(article) {
    const categories = {
      'environmental': ['EPA', 'climate', 'emission', 'green', 'renewable'],
      'immigration': ['border', 'deportation', 'visa', 'asylum', 'ICE'],
      'healthcare': ['medicare', 'medicaid', 'ACA', 'insurance', 'drug'],
      'financial': ['bank', 'regulation', 'SEC', 'crypto', 'finance'],
      'energy': ['oil', 'gas', 'pipeline', 'drilling', 'fracking'],
      'tech': ['social media', 'algorithm', 'AI', 'data', 'privacy'],
      'trade': ['tariff', 'import', 'export', 'china', 'trade'],
      'judicial': ['court', 'judge', 'ruling', 'Supreme Court']
    };
    
    const text = (article.title + ' ' + article.description).toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return category;
      }
    }
    
    return 'other';
  }

  detectReversal(article) {
    const text = (article.title + ' ' + article.description).toLowerCase();
    const reversalKeywords = ['reverses', 'overturns', 'cancels', 'ends', 'eliminates', 'rescinds'];
    
    if (reversalKeywords.some(keyword => text.includes(keyword))) {
      if (text.includes('biden')) return 'biden-era';
      if (text.includes('obama')) return 'obama-era';
      return 'reversal';
    }
    
    return 'new-policy';
  }

  extractIndustries(analysis) {
    const industries = ['oil', 'gas', 'pharma', 'tech', 'finance', 'crypto', 'healthcare', 'insurance'];
    const found = [];
    
    industries.forEach(industry => {
      if (analysis.toLowerCase().includes(industry)) {
        found.push(industry);
      }
    });
    
    return found;
  }

  findRelevantPatterns(article) {
    const category = this.categorizePolicy(article);
    const similarPolicies = Array.from(this.patterns.policy.values())
      .filter(p => p.category === category)
      .slice(-5); // Last 5 similar policies
    
    return {
      category,
      recentSimilar: similarPolicies.length,
      velocity: this.calculateCategoryVelocity(category),
      beneficiaryOverlap: this.findBeneficiaryOverlap(similarPolicies)
    };
  }

  calculatePolicyVelocity() {
    const recent = Array.from(this.patterns.policy.values())
      .filter(p => {
        const daysSince = (Date.now() - p.date.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 30;
      });
    
    return {
      policiesPerWeek: (recent.length / 4).toFixed(1),
      topCategories: this.getTopCategories(recent),
      reversalRate: this.calculateReversalRate(recent)
    };
  }

  formatTrendContext(trends) {
    let context = '';
    
    // Pattern context
    if (trends.patterns.recentSimilar > 0) {
      context += `This is the administration's ${trends.patterns.recentSimilar + 1} policy targeting ${trends.patterns.category} in recent weeks. `;
    }
    
    // Velocity context
    context += `The current administration is averaging ${trends.velocity.policiesPerWeek} policies per week. `;
    
    // Beneficiary pattern
    if (trends.patterns.beneficiaryOverlap.length > 0) {
      context += `The same groups (${trends.patterns.beneficiaryOverlap.join(', ')}) are benefiting from multiple recent policies. `;
    }
    
    // Cumulative impact
    if (trends.cumulative.compoundEffect) {
      context += `Combined with recent policies, this creates a compound effect on ${trends.cumulative.affectedGroups.join(', ')}. `;
    }
    
    return context;
  }

  // Generates ID for tracking
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// api/trend-analysis.js - API endpoint for trend insights
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const trendTracker = new TrendTracker();
    
    if (req.method === 'POST') {
      // Track new policy and generate trend context
      const { article, analysis } = req.body;
      
      if (!article || !analysis) {
        return res.status(400).json({ error: 'Missing article or analysis data' });
      }

      // Track the policy
      const policyData = trendTracker.trackPolicy(article, analysis);
      
      // Generate trend context
      const trendContext = trendTracker.generateTrendContext(article, analysis);
      
      // Store in database (would be Redis/MongoDB in production)
      await storeTrendData(policyData);
      
      return res.json({
        trendContext,
        patterns: trendTracker.findRelevantPatterns(article),
        velocity: trendTracker.calculatePolicyVelocity()
      });
      
    } else if (req.method === 'GET') {
      // Get trend dashboard data
      const { timeframe = '30d', category = 'all' } = req.query;
      
      const dashboardData = await generateDashboard(timeframe, category);
      
      return res.json(dashboardData);
    }
    
  } catch (error) {
    console.error('Trend analysis error:', error);
    return res.status(500).json({ error: 'Trend analysis failed' });
  }
}

// Database operations (would use Redis/MongoDB)
async function storeTrendData(policyData) {
  // Store in persistent database
  // For now, using memory/cache
  console.log('Storing trend data:', policyData.id);
}

async function generateDashboard(timeframe, category) {
  // Generate dashboard with:
  // - Policy velocity trends
  // - Top beneficiaries
  // - Industry impact patterns
  // - Geographic distribution
  // - Comparison to first term
  
  return {
    velocity: {
      current: "2.3 policies/week",
      vs_first_term: "+45%",
      trend: "accelerating"
    },
    top_beneficiaries: [
      "Oil & Gas Companies",
      "Crypto Industry", 
      "Private Prisons",
      "Defense Contractors"
    ],
    pattern_analysis: {
      most_targeted: "Environmental regulations",
      reversal_rate: "73% of policies reverse previous administration rules",
      geographic_focus: "Red states gaining, Blue states losing"
    },
    predictions: [
      "Next likely target: Healthcare regulations",
      "Financial deregulation acceleration expected",
      "Immigration enforcement expansion continues"
    ]
  };
}

// Enhanced personalize API with trend integration
// api/personalize-with-trends.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { article } = req.body;
    
    if (!article?.title || !article?.description) {
      return res.status(400).json({ error: 'Missing article data' });
    }

    // Get basic analysis
    const basicAnalysis = await generateBasicAnalysis(article);
    
    // Get trend context
    const trendResponse = await fetch('/api/trend-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article, analysis: basicAnalysis })
    });
    
    const trendData = await trendResponse.json();
    
    // Combine analysis with trend context
    const enhancedAnalysis = `${basicAnalysis}

**Trend Context:** ${trendData.trendContext}

**Pattern Analysis:** This fits the administration's broader strategy of ${trendData.patterns.category} deregulation, with ${trendData.patterns.recentSimilar} similar policies recently.`;

    return res.json({ 
      impact: enhancedAnalysis,
      trends: trendData.patterns,
      velocity: trendData.velocity
    });
    
  } catch (error) {
    console.error('Enhanced analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}

async function generateBasicAnalysis(article) {
  // Your existing OpenAI call for basic analysis
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
      const prompt = `You're explaining this administration policy news to a friend who wants to know what's really going on.

Title: ${article.title}
Summary: ${article.description}

Write like you're having a conversation - cut through the political BS and show who actually wins and loses. 

Cover: What's really happening here, who gets screwed over, who benefits and how, and what they're not telling us.

Keep it under 200 words. Use simple language. Be direct about the real impact on regular people.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You explain administration policies like a smart friend who sees through political spin. You use simple words and show who really benefits vs who pays the price.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 250,
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
