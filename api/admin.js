// api/admin.js - UPDATED for weekly operations with trend analysis
import { createClient } from '@supabase/supabase-js';
import { runAutomatedWeeklyWorkflow, AutomatedWeeklyPublisher } from './cron/automated-weekly-workflow.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Simple auth check
  const authHeader = req.headers.authorization;
  const adminKey = process.env.ADMIN_KEY || 'hdta-admin-2025-temp';
  
  if (!authHeader || authHeader !== `Bearer ${adminKey}`) {
    return res.status(401).json({ 
      error: 'Unauthorized - Invalid admin key'
    });
  }

  const { action } = req.query;

  try {
    switch (action) {
      case 'get-articles':
        return await getWeeklyArticles(req, res);
      case 'generate-analysis':
        return await generateAnalysis(req, res);
      case 'update-analysis':
        return await updateAnalysis(req, res);
      case 'update-status':
        return await updateStatus(req, res);
      case 'remove-article':
        return await removeArticle(req, res);
      case 'regenerate':
        return await regenerateWeekly(req, res);
      case 'clear-week':
        return await clearWeek(req, res);
      case 'reorder-article':
        return await reorderArticle(req, res);
      case 'get-trends':
        return await getTrends(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getWeeklyArticles(req, res) {
  try {
    const weekStart = getWeekStart();
    
    const { data: edition, error: editionError } = await supabase
      .from('weekly_editions')
      .select('*')
      .eq('week_start_date', weekStart)
      .single();

    if (editionError && editionError.code !== 'PGRST116') {
      throw editionError;
    }

    if (!edition) {
      return res.json({ 
        articles: [], 
        edition: null,
        message: 'No weekly edition found for this week' 
      });
    }

    const { data: articles, error: articlesError } = await supabase
      .from('analyzed_articles')
      .select('*')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (articlesError) {
      throw articlesError;
    }

    const formatted = articles?.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.image_url,
      source: { name: a.source_name },
      publishedAt: a.published_at,
      preGeneratedAnalysis: a.analysis_text,
      analysisWordCount: a.analysis_word_count,
      order: a.article_order,
      status: a.article_status || 'queue',
      score: a.article_score || 0
    })) || [];

    return res.json({
      articles: formatted,
      edition: {
        id: edition.id,
        week_start_date: edition.week_start_date,
        week_end_date: edition.week_end_date,
        issue_number: edition.issue_number,
        status: edition.status
      }
    });
  } catch (error) {
    console.error('Failed to get weekly articles:', error);
    return res.status(500).json({ error: 'Failed to load weekly articles: ' + error.message });
  }
}

async function generateAnalysis(req, res) {
  const { article } = req.body;
  
  if (!article || !article.title || !article.description) {
    return res.status(400).json({ error: 'Missing required article data (title, description)' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  if (!process.env.SYSTEM_PROMPT || !process.env.USER_PROMPT) {
    return res.status(500).json({ error: 'Analysis prompts not configured (SYSTEM_PROMPT, USER_PROMPT)' });
  }

  try {
    console.log(`🧠 Manual weekly analysis for: ${article.title.substring(0, 50)}...`);
    
    // Get trend context for this week
    const trendContext = await getWeeklyTrendContext();
    
    // Create publisher instance and generate analysis with trends
    const publisher = new AutomatedWeeklyPublisher();
    const analysis = await publisher.generateHumanImpactAnalysisWithTrends(article, trendContext);
    
    if (!analysis) {
      return res.status(500).json({ error: 'No analysis generated - OpenAI returned empty response' });
    }
    
    const sanitized = publisher.sanitize(article, analysis);
    
    if (!sanitized) {
      return res.status(400).json({ error: 'Analysis failed quality checks - try regenerating' });
    }
    
    const wordCount = sanitized.split(/\s+/).filter(Boolean).length;
    console.log(`✅ Manual weekly analysis: ${wordCount} words`);
    
    return res.json({ 
      success: true, 
      analysis: sanitized,
      wordCount: wordCount,
      trendContext: trendContext
    });
    
  } catch (error) {
    console.error('Manual weekly analysis failed:', error);
    
    if (error.message.includes('OpenAI')) {
      return res.status(500).json({ error: 'OpenAI API error: ' + error.message });
    } else if (error.message.includes('fetch')) {
      return res.status(500).json({ error: 'Network error connecting to OpenAI' });
    } else {
      return res.status(500).json({ error: 'Analysis generation failed: ' + error.message });
    }
  }
}

async function getWeeklyTrendContext() {
  try {
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: trendData, error } = await supabase
      .from('news_trends')
      .select('*')
      .gte('published_date', weekStart)
      .order('published_date', { ascending: false });

    if (error || !trendData || trendData.length === 0) {
      return '';
    }

    // Simple keyword frequency analysis
    const keywordCounts = {};
    trendData.forEach(item => {
      if (item.keywords) {
        item.keywords.split(',').forEach(keyword => {
          keyword = keyword.trim();
          if (keyword) {
            keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
          }
        });
      }
    });

    const topKeywords = Object.entries(keywordCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .filter(([keyword, count]) => count >= 3)
      .map(([keyword, count]) => `${keyword} (${count})`);

    if (topKeywords.length === 0) {
      return '';
    }

    return `This week's trending topics: ${topKeywords.join(', ')}`;
  } catch (error) {
    console.warn('⚠️ Failed to get trend context:', error.message);
    return '';
  }
}

async function updateAnalysis(req, res) {
  const { articleId, newAnalysis } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }
  
  if (!newAnalysis || typeof newAnalysis !== 'string' || !newAnalysis.trim()) {
    return res.status(400).json({ error: 'newAnalysis must be a non-empty string' });
  }

  const trimmedAnalysis = newAnalysis.trim();
  const wordCount = trimmedAnalysis.split(/\s+/).filter(Boolean).length;
  
  if (wordCount < 10) {
    return res.status(400).json({ error: 'Analysis must be at least 10 words' });
  }
  
  if (wordCount > 500) {
    return res.status(400).json({ error: 'Analysis must be under 500 words' });
  }
  
  try {
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const { error: updateError } = await supabase
      .from('analyzed_articles')
      .update({
        analysis_text: trimmedAnalysis,
        analysis_word_count: wordCount,
        analysis_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', articleId);

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ Updated weekly analysis for article ${existingArticle.title.substring(0, 30)}... (${wordCount} words)`);

    return res.json({ 
      success: true, 
      wordCount,
      articleId,
      message: 'Weekly analysis updated successfully'
    });
  } catch (error) {
    console.error('Failed to update weekly analysis:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

async function updateStatus(req, res) {
  const { articleId, status } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }
  
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const validStatuses = ['published', 'draft', 'queue', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title, article_status, edition_id')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // For weekly: enforce 10-article limit for published articles
    if (status === 'published' && existingArticle.article_status !== 'published') {
      const { data: publishedArticles, error: countError } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', existingArticle.edition_id)
        .eq('article_status', 'published');
      
      if (countError) {
        throw countError;
      }
      
      if (publishedArticles && publishedArticles.length >= 10) {
        return res.status(400).json({ 
          error: 'Cannot publish more than 10 articles per weekly edition. Demote another article first.',
          currentPublished: publishedArticles.length
        });
      }
    }

    const { error: updateError } = await supabase
      .from('analyzed_articles')
      .update({
        article_status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', articleId);

    if (updateError) {
      throw updateError;
    }

    console.log(`✅ Updated weekly article ${existingArticle.title.substring(0, 30)}... status to: ${status}`);

    return res.json({ 
      success: true, 
      articleId,
      status,
      previousStatus: existingArticle.article_status,
      message: `Weekly article status updated to ${status}`
    });
  } catch (error) {
    console.error('Failed to update weekly article status:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

async function removeArticle(req, res) {
  const { articleId } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }

  try {
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const { error: deleteError } = await supabase
      .from('analyzed_articles')
      .delete()
      .eq('id', articleId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`✅ Removed weekly article: ${existingArticle.title.substring(0, 50)}...`);

    return res.json({ 
      success: true,
      articleId,
      message: 'Weekly article removed successfully'
    });
  } catch (error) {
    console.error('Failed to remove weekly article:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

async function regenerateWeekly(req, res) {
  const startTime = Date.now();
  const weekStart = getWeekStart();
  
  try {
    console.log('🔄 Admin weekly regenerate started');
    
    // Check for existing edition
    const { data: existing } = await supabase
      .from('weekly_editions')
      .select('id')
      .eq('week_start_date', weekStart)
      .single();

    if (existing) {
      console.log('📰 Found existing weekly edition, workflow will handle it');
    }

    // Run the weekly automated workflow
    const edition = await runAutomatedWeeklyWorkflow();
    
    if (!edition || !edition.id) {
      throw new Error('Weekly workflow failed to return valid edition');
    }

    const duration = Math.floor((Date.now() - startTime) / 1000);

    // Get article count for response
    const { data: articles } = await supabase
      .from('analyzed_articles')
      .select('id, analysis_text')
      .eq('edition_id', edition.id);

    const analyzedCount = articles?.filter(a => 
      a.analysis_text && 
      a.analysis_text !== 'No analysis available' &&
      !a.analysis_text.includes('depends on implementation')
    ).length || 0;

    console.log(`✅ Weekly regenerate completed in ${duration}s - ${articles?.length || 0} articles, ${analyzedCount} analyzed`);

    return res.json({
      success: true,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        week_start_date: edition.week_start_date,
        week_end_date: edition.week_end_date,
        status: edition.status
      },
      processing: {
        duration_seconds: duration,
        articles_processed: articles?.length || 0,
        articles_analyzed: analyzedCount,
        success_rate: articles?.length > 0 ? Math.round((analyzedCount / articles.length) * 100) : 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    console.error('❌ Weekly regenerate failed after', duration, 'seconds:', error);
    
    return res.status(500).json({ 
      success: false,
      error: error.message,
      processing: {
        duration_seconds: duration,
        failed_at: 'weekly_workflow_execution'
      },
      timestamp: new Date().toISOString()
    });
  }
}

async function clearWeek(req, res) {
  const weekStart = getWeekStart();
  
  try {
    const { data: edition, error: fetchError } = await supabase
      .from('weekly_editions')
      .select('id')
      .eq('week_start_date', weekStart)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (edition) {
      // Delete articles first (foreign key constraint)
      await supabase.from('analyzed_articles').delete().eq('edition_id', edition.id);
      // Then delete edition
      await supabase.from('weekly_editions').delete().eq('id', edition.id);
      console.log(`✅ Cleared weekly edition ${edition.id} for week ${weekStart}`);
    } else {
      console.log(`ℹ️ No weekly edition found for ${weekStart} to clear`);
    }

    return res.json({ 
      success: true, 
      message: `This week's edition cleared successfully`,
      week_start: weekStart
    });
  } catch (error) {
    console.error('❌ Failed to clear weekly edition:', error);
    return res.status(500).json({ error: 'Failed to clear weekly edition: ' + error.message });
  }
}

async function reorderArticle(req, res) {
  const { articleId, direction } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }
  
  if (!direction || !['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  try {
    const { data: currentArticle, error: fetchError } = await supabase
      .from('analyzed_articles')
      .select('id, title, article_order, edition_id')
      .eq('id', articleId)
      .single();

    if (fetchError || !currentArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const currentOrder = currentArticle.article_order;
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;

    const { data: swapArticle, error: swapError } = await supabase
      .from('analyzed_articles')
      .select('id, title, article_order')
      .eq('edition_id', currentArticle.edition_id)
      .eq('article_order', newOrder)
      .single();

    if (swapError || !swapArticle) {
      return res.status(400).json({ 
        error: `Cannot move ${direction} - already at ${direction === 'up' ? 'top' : 'bottom'}` 
      });
    }

    // Perform the swap
    const tempOrder = 9999;
    
    await supabase
      .from('analyzed_articles')
      .update({ article_order: tempOrder })
      .eq('id', currentArticle.id);

    await supabase
      .from('analyzed_articles')
      .update({ article_order: currentOrder })
      .eq('id', swapArticle.id);

    await supabase
      .from('analyzed_articles')
      .update({ article_order: newOrder })
      .eq('id', currentArticle.id);

    console.log(`✅ Moved weekly article "${currentArticle.title.substring(0, 30)}..." ${direction} (${currentOrder} → ${newOrder})`);

    return res.json({
      success: true,
      message: `Weekly article moved ${direction} successfully`,
      articleId: articleId,
      oldOrder: currentOrder,
      newOrder: newOrder,
      swappedWith: swapArticle.title.substring(0, 30) + '...'
    });

  } catch (error) {
    console.error('❌ Reorder weekly article failed:', error);
    return res.status(500).json({ 
      error: 'Failed to reorder weekly article: ' + error.message 
    });
  }
}

async function getTrends(req, res) {
  try {
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: trendData, error } = await supabase
      .from('news_trends')
      .select('*')
      .gte('published_date', weekStart)
      .order('published_date', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    // Analyze trends
    const keywordCounts = {};
    const sourceCounts = {};
    const dailyCounts = {};

    trendData?.forEach(item => {
      // Keywords
      if (item.keywords) {
        item.keywords.split(',').forEach(keyword => {
          keyword = keyword.trim();
          if (keyword) {
            keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
          }
        });
      }

      // Sources
      if (item.source) {
        sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
      }

      // Daily counts
      const day = new Date(item.published_date).toISOString().split('T')[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });

    const topKeywords = Object.entries(keywordCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }));

    const topSources = Object.entries(sourceCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));

    return res.json({
      success: true,
      trends: {
        total_articles: trendData?.length || 0,
        top_keywords: topKeywords,
        top_sources: topSources,
        daily_counts: dailyCounts,
        week_start: weekStart
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Failed to get trends:', error);
    return res.status(500).json({ error: 'Failed to get trends: ' + error.message });
  }
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}
