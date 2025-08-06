// lib/redis.js - Clean Redis for news caching only
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Cache news list
async function storeNewsList(articles) {
  try {
    const TTL = 8 * 60 * 60; // 8 hours
    await redis.set('news:latest', JSON.stringify(articles), { ex: TTL });
    return true;
  } catch (error) {
    console.error('Redis store news error:', error);
    return false;
  }
}

// Get cached news list
async function getNewsList() {
  try {
    const cached = await redis.get('news:latest');
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Redis get news error:', error);
    return null;
  }
}

module.exports = {
  storeNewsList,
  getNewsList
};
