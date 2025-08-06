// api/cache-admin.js - Simple cache management
const { clearCache } = require('../lib/redis');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      // Simple status check
      res.status(200).json({
        message: 'Redis cache is connected',
        timestamp: new Date().toISOString()
      });
      
    } else if (req.method === 'POST') {
      const { action } = req.body;
      
      if (action === 'clear') {
        const deletedKeys = await clearCache();
        res.status(200).json({
          message: 'Cache cleared successfully',
          deleted_keys: deletedKeys,
          timestamp: new Date().toISOString()
        });
        
      } else {
        res.status(400).json({ error: 'Invalid action. Use "clear"' });
      }
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Cache admin error:', error);
    res.status(500).json({ 
      error: 'Cache operation failed',
      details: error.message
    });
  }
}
