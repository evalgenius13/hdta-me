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

    // Check if this article has pre-generated analysis
    if (article.preGeneratedAnalysis) {
      console.log('✅ Serving pre-generated analysis');
      return res.json({ 
        impact: article.preGeneratedAnalysis,
        source: 'automated',
        cached: true
      });
    }

    // If no pre-generated analysis, check if this is from our automated system
    if (article.isAnalyzed === false || !article.preGeneratedAnalysis) {
      console.log('⚠️ No pre-generated analysis found, generating on-demand...');
      
      // Fall back to real-time generation (for legacy support or edge cases)
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      if (!OPENAI_API_KEY) {
        return res.status(500).json({ 
          error: 'Analysis service unavailable',
          message: 'Pre-generated analysis not found and real-time generation is not configured'
        });
      }

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
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
      
      if (data.choices?.[0]?.message?.content) {
        console.log('✅ Generated real-time analysis (fallback)');
        return res.json({ 
          impact: data.choices[0].message.content.trim(),
          source: 'real-time',
          cached: false
        });
      } else {
        throw new Error('No analysis content received from OpenAI');
      }
    }

    // If we get here, something unexpected happened
    return res.status(500).json({ 
      error: 'Unable to provide analysis',
      message: 'Analysis not available for this article'
    });

  } catch (error) {
    console.error('Analysis error:', error);
    
    // Provide helpful fallback response
    const fallbackAnalysis = `This policy change represents a shift in how government approaches this issue. While the full impact may take time to understand, it's worth monitoring how this affects different communities and staying informed about implementation details.`;
    
    return res.json({ 
      impact: fallbackAnalysis,
      source: 'fallback',
      cached: false,
      note: 'Detailed analysis temporarily unavailable'
    });
  }
}
