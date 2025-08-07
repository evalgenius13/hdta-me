// api/personalize.js - Enhanced with real trend analysis
import { trendTracker } from '../lib/trend-tracker.js';

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

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    // Generate trend context from real analyzed data
    const trendContext = trendTracker.generateTrendContext(article);

    // Create enhanced prompt
    let prompt = `You're explaining this administration policy news to a friend who wants to know what's really going on.

Title: ${article.title}
Summary: ${article.description}`;

    if (trendContext) {
      prompt += `\n\nTREND CONTEXT: ${trendContext}`;
    }

    prompt += `\n\nWrite like you're having a conversation - cut through the political BS and show who actually wins and loses.`;
    
    if (trendContext) {
      prompt += ` Naturally incorporate the trend context to show this is part of a larger pattern.`;
    }

    prompt += `\n\nCover: What's really happening here, who gets screwed over, who benefits and how, and what they're not telling us.

Keep it under 250 words. Use simple language. Be direct about the real impact on regular people.`;

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
            content: 'You explain administration policies like a smart friend who sees through political spin. You use simple words, show who really benefits vs who pays the price, and naturally incorporate trend context to show patterns.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    
    if (data.choices?.[0]?.message?.content) {
      const analysis = data.choices[0].message.content.trim();
      
      // Track this analysis for future trend detection
      trendTracker.trackAnalysis(article, analysis);
      
      return res.json({ impact: analysis });
    } else {
      return res.status(500).json({ error: 'Unable to generate analysis' });
    }
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}
