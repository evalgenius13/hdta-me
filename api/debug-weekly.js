// api/debug-weekly.js - Diagnostic tool to check database state
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const thisWeek = getWeekStart();
  
  try {
    console.log('🔍 Weekly Debug Starting...');
    console.log('📅 This week:', thisWeek);

    // 1. Check all weekly editions
    const { data: allEditions, error: editionsError } = await supabase
      .from('weekly_editions')
      .select('*')
      .order('week_start_date', { ascending: false });
    
    if (editionsError) {
      console.error('❌ Error fetching editions:', editionsError);
      return res.status(500).json({ error: 'Error fetching editions', details: editionsError });
    }

    console.log(`📊 Found ${allEditions?.length || 0} total weekly editions`);

    // 2. Check this week's edition specifically
    const { data: thisWeekEdition, error: thisWeekError } = await supabase
      .from('weekly_editions')
      .select('*')
      .eq('week_start_date', thisWeek)
      .single();

    console.log('📰 This week edition:', thisWeekEdition ? 'Found' : 'Not found');
    if (thisWeekError) console.log('📰 This week error:', thisWeekError.message);

    // 3. Check latest edition
    const { data: latestEdition, error: latestError } = await supabase
      .from('weekly_editions')
      .select('*')
      .order('week_start_date', { ascending: false })
      .limit(1)
      .single();

    console.log('📰 Latest edition:', latestEdition ? `Found (${latestEdition.week_start_date})` : 'Not found');

    // 4. Check articles for each edition
    const editionResults = [];
    if (allEditions && allEditions.length > 0) {
      for (const edition of allEditions.slice(0, 3)) { // Check top 3 editions
        const { data: articles, error: articlesError } = await supabase
          .from('analyzed_articles')
          .select('id, title, article_status, article_order')
          .eq('edition_id', edition.id)
          .order('article_order');

        const publishedCount = articles?.filter(a => a.article_status === 'published').length || 0;
        
        editionResults.push({
          edition_id: edition.id,
          issue_number: edition.issue_number,
          week_start_date: edition.week_start_date,
          week_end_date: edition.week_end_date,
          status: edition.status,
          total_articles: articles?.length || 0,
          published_articles: publishedCount,
          articles_error: articlesError?.message || null,
          sample_articles: articles?.slice(0, 3).map(a => ({
            title: a.title?.substring(0, 50) + '...',
            status: a.article_status,
            order: a.article_order
          })) || []
        });
      }
    }

    // 5. Simulate the fetch-news query exactly
    const simulatedResult = await simulateFetchNewsQuery(thisWeek);

    return res.json({
      debug_info: {
        timestamp: new Date().toISOString(),
        this_week: thisWeek,
        database_check: 'success'
      },
      weekly_editions: {
        total_count: allEditions?.length || 0,
        this_week_found: !!thisWeekEdition,
        latest_edition: latestEdition ? {
          id: latestEdition.id,
          issue_number: latestEdition.issue_number,
          week_start_date: latestEdition.week_start_date,
          status: latestEdition.status
        } : null
      },
      edition_details: editionResults,
      fetch_news_simulation: simulatedResult,
      recommendations: generateRecommendations(editionResults, thisWeekEdition, simulatedResult)
    });

  } catch (error) {
    console.error('❌ Debug failed:', error);
    return res.status(500).json({ 
      error: 'Debug failed', 
      details: error.message,
      stack: error.stack 
    });
  }
}

async function simulateFetchNewsQuery(thisWeek) {
  try {
    // Simulate exact fetch-news.js logic
    console.log('🔍 Simulating fetch-news query...');

    // Step 1: Get this week's edition
    let { data: edition, error: edErr } = await supabase
      .from('weekly_editions')
      .select('id, issue_number, status, week_start_date, week_end_date, featured_headline')
      .eq('week_start_date', thisWeek)
      .single();

    let editionSource = 'this_week';

    // Step 2: If no edition for this week, try latest
    if (edErr || !edition) {
      const { data: latestEdition, error: latestErr } = await supabase
        .from('weekly_editions')
        .select('id, issue_number, status, week_start_date, week_end_date, featured_headline')
        .in('status', ['published', 'sent'])
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single();

      if (latestEdition) {
        edition = latestEdition;
        editionSource = 'latest_published';
      }
    }

    if (!edition) {
      return {
        success: false,
        reason: 'no_edition_found',
        this_week_error: edErr?.message,
        latest_error: 'No published editions found'
      };
    }

    // Step 3: Get articles
    const { data: articles, error: articlesError } = await supabase
      .from('analyzed_articles')
      .select('id, title, description, url, image_url, source_name, published_at, analysis_text, article_status, article_order, article_score')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    if (articlesError) {
      return {
        success: false,
        reason: 'articles_query_failed',
        edition_found: edition,
        articles_error: articlesError.message
      };
    }

    // Step 4: Filter published articles
    const publishedArticles = (articles || [])
      .filter(a => (a.article_status || '').toString().trim().toLowerCase() === 'published')
      .slice(0, 10);

    return {
      success: true,
      edition_source: editionSource,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        week_start_date: edition.week_start_date,
        status: edition.status
      },
      articles_total: articles?.length || 0,
      articles_published: publishedArticles.length,
      published_articles: publishedArticles.map(a => ({
        title: a.title?.substring(0, 50) + '...',
        status: a.article_status,
        has_analysis: !!(a.analysis_text && a.analysis_text.trim())
      }))
    };

  } catch (error) {
    return {
      success: false,
      reason: 'simulation_error',
      error: error.message
    };
  }
}

function generateRecommendations(editionResults, thisWeekEdition, simulatedResult) {
  const recommendations = [];

  if (!thisWeekEdition) {
    recommendations.push({
      issue: 'no_current_week_edition',
      solution: 'Run manual trigger to create this week\'s edition',
      action: 'Visit /admin.html and click "🔄 Fetch Fresh Articles"'
    });
  }

  if (simulatedResult.success && simulatedResult.articles_published === 0) {
    recommendations.push({
      issue: 'no_published_articles',
      solution: 'Articles exist but none are published',
      action: 'Use admin panel to promote articles from queue to published'
    });
  }

  if (editionResults.length > 0) {
    const latestEdition = editionResults[0];
    if (latestEdition.published_articles === 0) {
      recommendations.push({
        issue: 'latest_edition_no_published',
        solution: 'Latest edition has articles but none published',
        action: 'Check admin panel to publish articles'
      });
    }
  }

  if (!simulatedResult.success) {
    recommendations.push({
      issue: 'fetch_query_failing',
      solution: 'The fetch-news query is failing',
      action: 'Check database structure and permissions'
    });
  }

  return recommendations;
}
