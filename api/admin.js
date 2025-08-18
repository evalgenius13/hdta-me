// api/admin.js - FIXED manual analysis functionality with proper error handling AND article reordering
import { createClient } from '@supabase/supabase-js';
import { runAutomatedWorkflow, AutomatedPublisher } from './cron/automated-daily-workflow.js';

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
        return await getArticles(req, res);
      case 'generate-analysis':
        return await generateAnalysis(req, res);
      case 'update-analysis':
        return await updateAnalysis(req, res);
      case 'update-status':
        return await updateStatus(req, res);
      case 'remove-article':
        return await removeArticle(req, res);
      case 'regenerate':
        return await regenerateToday(req, res);
      case 'clear-today':
        return await clearToday(req, res);
      case 'reorder-article':
        return await reorderArticle(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// FIXED: Generate analysis with proper error handling - reverted to env vars
async function generateAnalysis(req, res) {
  const { article } = req.body;
  
  // Validate input
  if (!article || !article.title || !article.description) {
    return res.status(400).json({ error: 'Missing required article data (title, description)' });
  }

  // Check environment variables
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  if (!process.env.SYSTEM_PROMPT || !process.env.USER_PROMPT) {
    return res.status(500).json({ error: 'Analysis prompts not configured (SYSTEM_PROMPT, USER_PROMPT)' });
  }

  try {
    console.log(`🧠 Manual analysis for: ${article.title.substring(0, 50)}...`);
    
    // Create publisher instance and generate analysis
    const publisher = new AutomatedPublisher();
    const analysis = await publisher.generateHumanImpactAnalysis(article);
    
    if (!analysis) {
      return res.status(500).json({ error: 'No analysis generated - OpenAI returned empty response' });
    }
    
    // Sanitize and validate the analysis
    const sanitized = publisher.sanitize(article, analysis);
    
    if (!sanitized) {
      return res.status(400).json({ error: 'Analysis failed quality checks - try regenerating' });
    }
    
    const wordCount = sanitized.split(/\s+/).filter(Boolean).length;
    console.log(`✅ Manual analysis: ${wordCount} words`);
    
    // Return analysis without auto-saving - let frontend handle the save
    return res.json({ 
      success: true, 
      analysis: sanitized,
      wordCount: wordCount
    });
    
  } catch (error) {
    console.error('Manual analysis failed:', error);
    
    // Provide more specific error messages
    if (error.message.includes('OpenAI')) {
      return res.status(500).json({ error: 'OpenAI API error: ' + error.message });
    } else if (error.message.includes('fetch')) {
      return res.status(500).json({ error: 'Network error connecting to OpenAI' });
    } else {
      return res.status(500).json({ error: 'Analysis generation failed: ' + error.message });
    }
  }
}

async function getArticles(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: edition, error: editionError } = await supabase
      .from('daily_editions')
      .select('*')
      .eq('edition_date', today)
      .single();

    if (editionError && editionError.code !== 'PGRST116') {
      throw editionError;
    }

    if (!edition) {
      return res.json({ 
        articles: [], 
        edition: null,
        message: 'No edition found for today' 
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
        date: edition.edition_date,
        issue_number: edition.issue_number,
        status: edition.status
      }
    });
  } catch (error) {
    console.error('Failed to get articles:', error);
    return res.status(500).json({ error: 'Failed to load articles: ' + error.message });
  }
}

async function updateAnalysis(req, res) {
  const { articleId, newAnalysis } = req.body;
  
  // Validate input
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }
  
  if (!newAnalysis || typeof newAnalysis !== 'string' || !newAnalysis.trim()) {
    return res.status(400).json({ error: 'newAnalysis must be a non-empty string' });
  }

  const trimmedAnalysis = newAnalysis.trim();
  const wordCount = trimmedAnalysis.split(/\s+/).filter(Boolean).length;
  
  // Validate word count
  if (wordCount < 10) {
    return res.status(400).json({ error: 'Analysis must be at least 10 words' });
  }
  
  if (wordCount > 500) {
    return res.status(400).json({ error: 'Analysis must be under 500 words' });
  }
  
  try {
    // First check if article exists
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Update the analysis
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

    console.log(`✅ Updated analysis for article ${existingArticle.title.substring(0, 30)}... (${wordCount} words)`);

    return res.json({ 
      success: true, 
      wordCount,
      articleId,
      message: 'Analysis updated successfully'
    });
  } catch (error) {
    console.error('Failed to update analysis:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

// FIXED: Status update with proper validation and 6-article limit enforcement
async function updateStatus(req, res) {
  const { articleId, status } = req.body;
  
  // Validate input
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
    // First check if article exists
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title, article_status, edition_id')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // If promoting to published, check current published count for this edition
    if (status === 'published' && existingArticle.article_status !== 'published') {
      const { data: publishedArticles, error: countError } = await supabase
        .from('analyzed_articles')
        .select('id')
        .eq('edition_id', existingArticle.edition_id)
        .eq('article_status', 'published');
      
      if (countError) {
        throw countError;
      }
      
      if (publishedArticles && publishedArticles.length >= 6) {
        return res.status(400).json({ 
          error: 'Cannot publish more than 6 articles per edition. Demote another article first.',
          currentPublished: publishedArticles.length
        });
      }
    }

    // Update the status
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

    console.log(`✅ Updated article ${existingArticle.title.substring(0, 30)}... status to: ${status}`);

    return res.json({ 
      success: true, 
      articleId,
      status,
      previousStatus: existingArticle.article_status,
      message: `Article status updated to ${status}`
    });
  } catch (error) {
    console.error('Failed to update status:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

async function removeArticle(req, res) {
  const { articleId } = req.body;
  
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }

  try {
    // First check if article exists and get its info
    const { data: existingArticle, error: checkError } = await supabase
      .from('analyzed_articles')
      .select('id, title')
      .eq('id', articleId)
      .single();

    if (checkError || !existingArticle) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Delete the article
    const { error: deleteError } = await supabase
      .from('analyzed_articles')
      .delete()
      .eq('id', articleId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`✅ Removed article: ${existingArticle.title.substring(0, 50)}...`);

    return res.json({ 
      success: true,
      articleId,
      message: 'Article removed successfully'
    });
  } catch (error) {
    console.error('Failed to remove article:', error);
    return res.status(500).json({ error: 'Database error: ' + error.message });
  }
}

// FIXED: Simplified regenerate that uses existing workflow without breaking it
async function regenerateToday(req, res) {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    console.log('🔄 Admin regenerate started');
    
    // Check for existing edition - let runAutomatedWorkflow handle deletion if needed
    const { data: existing } = await supabase
      .from('daily_editions')
      .select('id')
      .eq('edition_date', today)
      .single();

    if (existing) {
      console.log('📰 Found existing edition, workflow will handle it');
    }

    // Run the existing automated workflow - it handles existing editions
    const edition = await runAutomatedWorkflow();
    
    if (!edition || !edition.id) {
      throw new Error('Workflow failed to return valid edition');
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

    console.log(`✅ Regenerate completed in ${duration}s - ${articles?.length || 0} articles, ${analyzedCount} analyzed`);

    return res.json({
      success: true,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        date: edition.edition_date,
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
    console.error('❌ Regenerate failed after', duration, 'seconds:', error);
    
    return res.status(500).json({ 
      success: false,
      error: error.message,
      processing: {
        duration_seconds: duration,
        failed_at: 'workflow_execution'
      },
      timestamp: new Date().toISOString()
    });
  }
}

async function clearToday(req, res) {
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const { data: edition, error: fetchError } = await supabase
      .from('daily_editions')
      .select('id')
      .eq('edition_date', today)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (edition) {
      // Delete articles first (foreign key constraint)
      await supabase.from('analyzed_articles').delete().eq('edition_id', edition.id);
      // Then delete edition
      await supabase.from('daily_editions').delete().eq('id', edition.id);
      console.log(`✅ Cleared edition ${edition.id} for ${today}`);
    } else {
      console.log(`ℹ️ No edition found for ${today} to clear`);
    }

    return res.json({ 
      success: true, 
      message: `Today's edition cleared successfully`,
      date: today
    });
  } catch (error) {
    console.error('❌ Failed to clear edition:', error);
    return res.status(500).json({ error: 'Failed to clear edition: ' + error.message });
  }
}

async function reorderArticle(req, res) {
  const { articleId, direction } = req.body;
  
  // Validate input
  if (!articleId) {
    return res.status(400).json({ error: 'articleId is required' });
  }
  
  if (!direction || !['up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }

  try {
    // Get the current article
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

    // Find the article to swap with
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

    // Perform the swap using a transaction-like approach
    // First, temporarily set one to a high number to avoid constraint conflicts
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

    console.log(`✅ Moved "${currentArticle.title.substring(0, 30)}..." ${direction} (${currentOrder} → ${newOrder})`);

    return res.json({
      success: true,
      message: `Article moved ${direction} successfully`,
      articleId: articleId,
      oldOrder: currentOrder,
      newOrder: newOrder,
      swappedWith: swapArticle.title.substring(0, 30) + '...'
    });

  } catch (error) {
    console.error('❌ Reorder article failed:', error);
    return res.status(500).json({ 
      error: 'Failed to reorder article: ' + error.message 
    });
  }
}
