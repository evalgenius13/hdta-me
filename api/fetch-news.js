// api/fetch-news.js - FIXED for weekly operations (PostgREST embedding issue resolved)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
}

// ✅ FIXED: Standardized UTC-based week calculation
function getWeekStart() {
  const now = new Date();
  
  // Use UTC to avoid timezone issues
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  
  const dayOfWeek = utc.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7; // Convert Sunday=0 to Monday=0 system
  
  // Calculate Monday of this week
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - daysFromMonday);
  
  return monday.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  console.log('🔍 Fetch weekly news called (READ-ONLY mode):', new Date().toISOString());

  const thisWeek = getWeekStart();

  try {
    // Check if Supabase is configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.log('⚠️ Supabase not configured');
      return returnNoArticlesMessage(res, 'Database not configured');
    }

    // Helper functions for safe filtering
    const isPublished = (s) => (s || '').toString().trim().toLowerCase() === 'published';
    const hasText = (s) => typeof s === 'string' && s.trim().length > 0;

    // STEP 1: Get this week's edition (FIXED - removed PostgREST embedding)
    let { data: edition, error: edErr } = await supabase
      .from('weekly_editions')
      .select('id, issue_number, status, week_start_date, week_end_date, featured_headline')
      .eq('week_start_date', thisWeek)
      .single();

    console.log('📊 This week\'s edition query:', { found: !!edition, error: edErr?.message });

    // STEP 2: If no edition for this week, try latest edition
    if (edErr || !edition) {
      console.log('📅 No edition for this week, checking for latest edition...');
      
      const { data: latestEdition, error: latestErr } = await supabase
        .from('weekly_editions')
        .select('id, issue_number, status, week_start_date, week_end_date, featured_headline')
        .in('status', ['published', 'sent'])
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single();

      console.log('📊 Latest weekly edition query:', { found: !!latestEdition, error: latestErr?.message });

      if (latestErr || !latestEdition) {
        console.log('❌ No weekly editions found in database at all');
        return returnNoArticlesMessage(res, 'No articles available - run weekly workflow or manual trigger');
      }

      edition = latestEdition;
      console.log(`✅ Using latest weekly edition: ${edition.week_start_date} to ${edition.week_end_date} (Issue #${edition.issue_number})`);
    }

    // STEP 3: Get articles for this edition from database (separate query - no embedding)
    const { data: rows, error: artErr } = await supabase
      .from('analyzed_articles')
      .select('id, title, description, url, image_url, source_name, published_at, analysis_text, article_status, article_order, article_score')
      .eq('edition_id', edition.id)
      .order('article_order', { ascending: true });

    console.log('📊 Weekly articles query:', { count: rows?.length || 0, error: artErr?.message });

    if (artErr) {
      console.error('❌ Database error fetching weekly articles:', artErr);
      return returnNoArticlesMessage(res, 'Database error loading weekly articles');
    }

    if (!rows || rows.length === 0) {
      console.log('❌ Weekly edition exists but has no articles');
      return returnNoArticlesMessage(res, 'Weekly edition exists but contains no articles');
    }

    // STEP 4: Get published articles (top 10 for weekly)
    const publishedArticles = (rows || [])
      .filter(a => isPublished(a.article_status))
      .slice(0, 10) // Limit to 10 for weekly
      .map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        urlToImage: a.image_url,
        source: { name: a.source_name || 'Unknown Source' },
        publishedAt: a.published_at,
        preGeneratedAnalysis: a.analysis_text,
        isAnalyzed: hasText(a.analysis_text)
      }));

    console.log(`✅ Returning ${publishedArticles.length} published weekly articles from database`);
    console.log(`📊 Total articles in weekly edition: ${rows.length}, Published: ${publishedArticles.length}`);

    // STEP 5: FALLBACK - Only to released editions (keep status filter for fallbacks)
    if ((!publishedArticles || publishedArticles.length === 0) && edition && edition.week_start_date === thisWeek) {
      console.log('🔄 This week\'s edition has no published articles, checking for fallback...');
      
      const { data: latestEdition, error: latestErr } = await supabase
        .from('weekly_editions')
        .select('id, issue_number, status, week_start_date, week_end_date, featured_headline')
        .in('status', ['published', 'sent'])
        .order('week_start_date', { ascending: false })
        .limit(1)
        .single();

      if (!latestErr && latestEdition) {
        const { data: rows2, error: artErr2 } = await supabase
          .from('analyzed_articles')
          .select('id, title, description, url, image_url, source_name, published_at, analysis_text, article_status, article_order')
          .eq('edition_id', latestEdition.id)
          .order('article_order', { ascending: true });

        const fallback = (rows2 || [])
          .filter(a => isPublished(a.article_status))
          .slice(0, 10)
          .map(a => ({
            title: a.title,
            description: a.description,
            url: a.url,
            urlToImage: a.image_url,
            source: { name: a.source_name || 'Unknown Source' },
            publishedAt: a.published_at,
            preGeneratedAnalysis: a.analysis_text,
            isAnalyzed: hasText(a.analysis_text)
          }));

        if (fallback.length) {
          console.log(`🔄 Using fallback weekly edition: ${latestEdition.week_start_date} to ${latestEdition.week_end_date} with ${fallback.length} articles`);
          
          return res.json({
            articles: fallback,
            count: fallback.length,
            edition_info: {
              week_start_date: latestEdition.week_start_date,
              week_end_date: latestEdition.week_end_date,
              issue_number: latestEdition.issue_number,
              mode: 'fallback_to_released',
              is_current_week: false,
              total_articles: rows2?.length || 0,
              published_articles: fallback.length
            }
          });
        }
      }
    }

    // Calculate week info
    const weekEnd = new Date(new Date(edition.week_start_date).getTime() + 6 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    return res.json({
      articles: publishedArticles,
      count: publishedArticles.length,
      edition_info: {
        week_start_date: edition.week_start_date,
        week_end_date: edition.week_end_date || weekEnd,
        issue_number: edition.issue_number,
        is_automated: true,
        is_current_week: edition.week_start_date === thisWeek,
        total_articles: rows.length,
        published_articles: publishedArticles.length
      }
    });

  } catch (error) {
    console.error('❌ Unexpected error in fetch weekly news:', error);
    return returnNoArticlesMessage(res, 'Unexpected server error');
  }
}

// Helper function to return consistent "no articles" response
function returnNoArticlesMessage(res, reason) {
  const thisWeek = getWeekStart();
  const weekEnd = new Date(new Date(thisWeek).getTime() + 6 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  
  console.log(`📭 Returning no weekly articles: ${reason}`);
  
  return res.json({
    articles: [],
    count: 0,
    edition_info: {
      week_start_date: thisWeek,
      week_end_date: weekEnd,
      issue_number: 'No Data',
      is_automated: false,
      is_current_week: true,
      message: reason
    },
    error: reason,
    instructions: {
      message: 'No weekly articles available. Articles are curated once weekly or via manual trigger.',
      actions: [
        'Wait for weekly cron job (runs Mondays at 10 AM)',
        'Use admin panel to manually trigger weekly article curation',
        'Check Vercel cron job logs for any failures'
      ]
    }
  });
}
