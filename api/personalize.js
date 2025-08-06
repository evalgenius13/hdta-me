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
  return `You're a knowledgeable analyst breaking down a policy story. Be clear and direct without being overly casual.

ARTICLE: "${article.title}"
FULL CONTENT: "${fullContent}"
READER: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Explain the real impact:

How does this directly affect someone with their income and situation? Be specific about costs, benefits, or changes they'll experience.

Who actually wins and loses from this policy? Follow the money and power - what's the real motivation here?

What important details is the article leaving out or downplaying? Give an example of how similar policies worked in other places.

Use clear, short paragraphs. Keep it under 250 words. Be direct about the reality.`;
}

// Basic prompt for headline/description only  
function createBasicPrompt(article, demographic) {
  return `You're an analyst explaining a policy story clearly and directly.

STORY: "${article.title}"
SUMMARY: "${article.description}"
READER: ${demographic.detailed.age}, ${demographic.detailed.income}, living in ${demographic.location}.

Break down the real impact:

How does this affect someone in their situation? Be specific about what changes for them financially or practically.

Who benefits from this policy and who pays the price? Cut through the political language to show what's really happening.

What's the article not emphasizing? Include a real example from another state or similar policy.

Write clearly with short paragraphs. Under 200 words. Be straightforward about winners and losers.`;
}
