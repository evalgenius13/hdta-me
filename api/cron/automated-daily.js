import { runAutomatedWorkflow } from './automated-daily-workflow.js';

export default async function handler(req, res) {
  // Verify this is a legitimate cron request
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  
  if (!authHeader || authHeader !== expectedAuth) {
    console.error('🚨 Unauthorized cron access attempt:', {
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    });
    
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  console.log('🤖 Automated daily workflow started:', new Date().toISOString());

  try {
    // Run the fully automated workflow
    const edition = await runAutomatedWorkflow();
    
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    const successResponse = {
      success: true,
      edition: {
        id: edition.id,
        issue_number: edition.issue_number,
        date: edition.edition_date,
        status: edition.status,
        featured_headline: edition.featured_headline
      },
      workflow: {
        processing_time_seconds: duration,
        auto_published: true,
        newsletter_scheduled: true
      },
      timestamp: new Date().toISOString()
    };

    console.log('✅ Automated workflow completed successfully:', successResponse);
    
    res.json(successResponse);

  } catch (error) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: error.constructor.name
      },
      workflow: {
        processing_time_seconds: duration,
        auto_published: false,
        fallback_attempted: true
      },
      timestamp: new Date().toISOString()
    };

    console.error('❌ Automated workflow failed:', errorResponse);
    
    // Try to send admin notification
    await notifyAdminOfFailure(error, errorResponse);
    
    res.status(500).json(errorResponse);
  }
}

async function notifyAdminOfFailure(error, errorResponse) {
  try {
    // Log detailed failure information
    console.error('🚨 AUTOMATED WORKFLOW FAILURE DETAILS:', {
      error: error.message,
      stack: error.stack,
      response: errorResponse,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
      }
    });

    // TODO: Implement actual notifications when you're ready
    // Examples:
    
    // Email notification:
    // await sendEmailNotification({
    //   to: 'admin@hdta.me',
    //   subject: 'HDTA.me Daily Workflow Failed',
    //   body: `Workflow failed: ${error.message}`
    // });
    
    // Slack webhook:
    // await fetch(process.env.SLACK_WEBHOOK_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     text: `🚨 HDTA.me workflow failed: ${error.message}`
    //   })
    // });
    
    console.log('📧 Admin notification logged (implement actual notification when ready)');
    
  } catch (notificationError) {
    console.error('Failed to send admin notification:', notificationError);
  }
}
