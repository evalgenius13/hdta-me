// api/chat.js - Enhanced with Redis trend analysis capabilities
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
    const { message, article } = req.body;
    
    if (!message || !article?.title) {
      return res.status(400).json({ error: 'Missing message or article data' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Service unavailable' });
    }

    // Detect if this is a trend-related question
    const isTrendQuery = detectTrendQuery(message);
    
    let prompt;
    if (isTrendQuery) {
      // Use real trend data from Redis to answer (with fallback)
      const category = trendTracker.detectCategory(article);
      let trendResponse;
      try {
        trendResponse = await trendTracker.answerTrendQuestion(message, category);
      } catch (error) {
        console.error('Error getting trend response:', error);
        trendResponse = "I'm having trouble accessing trend data right now.";
      }
      
      prompt = `You're answering a trend analysis question about administration policies.

ORIGINAL STORY: "${article.title}"
USER QUESTION: "${message}"
REAL TREND DATA: ${trendResponse}

Use the real trend data provided to answer the question. Be conversational and direct. Keep it under 150 words.`;
    } else {
      // Regular follow-up question
      prompt = `You're answering a follow-up question about this news story:

STORY: "${article.title}"
SUMMARY: "${article.description}"
QUESTION: "${message}"

Answer like a knowledgeable friend who sees through political spin. Keep it conversational, factual, and under 150 words. If you don't know something specific, say so rather than guessing.`;
    }

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
            content: 'You answer questions about news stories and policy trends using real data. You cut through spin, show patterns, and keep responses conversational and helpful.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    
    if (data.choices?.[0]?.message?.content) {
      return res.json({ response: data.choices[0].message.content.trim() });
    } else {
      return res.status(500).json({ error: 'Unable to generate response' });
    }
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Chat failed' });
  }
}

function detectTrendQuery(message) {
  const trendKeywords = [
    'pattern', 'trend', 'how many', 'count', 'similar', 'compare',
    'recent', 'lately', 'often', 'pace', 'speed', 'benefi', 'winner'
  ];
  
  const lowerMessage = message.toLowerCase();
  return trendKeywords.some(keyword => lowerMessage.includes(keyword));
}
