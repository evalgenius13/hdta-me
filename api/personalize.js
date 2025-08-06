// api/personalize.js - Enhanced with full article analysis
const { getFullArticle } = require('../lib/redis');

// Simple in-memory cache for AI responses
const responseCache = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { article, demographic } = req.body;
    
    if (!article || !demographic) {
      res.status(400).json({ error: 'Missing article or demographic data' });
      return;
    }

    // Create cache key
    const cacheKey = `${article.title}-${demographic.age}-${demographic.income}-${demographic.location}`;
    
    // Check cache first
    if (responseCache.has(cacheKey)) {
      return res.status(200).json({ 
        impact: responseCache.get(cacheKey),
        cached: true 
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    // Try to get full article content
    let articleContent = article.description; // Fallback
    let analysisType = 'headline';
    
    if (article.url) {
      const fullContent = await getFullArticle(article.url);
      if (fullContent) {
        articleContent = fullContent;
        analysisType = 'full-article';
        console.log('Using full article content for deeper analysis');
      } else {
        console.log('No full content available, using description');
      }
    }

    // Create enhanced prompt
    const prompt = analysisType === 'full-article' 
      ? createEnhancedPrompt(article, articleContent, demographic)
      : createBasicPrompt(article, demographic);

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
            content: 'You are a professional news analyst who cuts through political spin to show real-world impacts on regular people.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: analysisType === 'full-article' ? 350 : 300,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      res.status(response.status).json({ error: 'OpenAI API request failed' });
      return;
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const impact = data.choices[0].message.content.trim();
      
      // Cache the response
      responseCache.set(cacheKey, impact);
      
      res.status(200).json({ 
        impact,
        analysisType,
        cached: false
      });
    } else {
      console.error('Unexpected OpenAI response format:', data);
      res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    }

  } catch (error) {
    console.error('Error in personalize API:', error);
    res.status(500).json({ error: 'Failed to generate personalized analysis' });
  }
};

// Enhanced prompt for full article content
function createEnhancedPrompt(article, fullContent, demographic) {
  return `You are analyzing a government policy article to reveal real-world impacts.

ARTICLE TITLE: "${article.title}"

FULL ARTICLE CONTENT: "${fullContent}"

READER PROFILE: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Analyze how this policy specifically affects someone with these demographics. Focus on:

1. DIRECT PERSONAL IMPACT: Concrete effects on their finances, benefits, eligibility, or daily life
2. FOLLOW THE MONEY: Who actually profits from this policy and who pays the cost
3. WHAT'S HIDDEN: Critical details the article glosses over or political spin being used
4. REAL EXAMPLES: How similar policies played out in other states or timeframes

Write as a clear, conversational explanation. No bullet points. Keep under 250 words. Be direct about winners and losers.`;
}

// Basic prompt for headline/description only  
function createBasicPrompt(article, demographic) {
  return `You are a news analyst who explains how government policies affect regular people in plain English.

Article: "${article.title}"
Summary: "${article.description}"

Reader: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Explain how this affects them personally, then reveal who actually benefits and gets hurt by this policy. Point out what the article isn't telling us and why that matters. Include real examples from other states when relevant.

Write this as a clear explanation, not bullet points or formal sections. Keep it under 180 words and be direct about winners and losers.`;
}
