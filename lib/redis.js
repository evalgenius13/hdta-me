// lib/redis.js - Final working Redis setup
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Cache news list for 8 hours
async function storeNewsList(articles) {
  try {
    const TTL = 8 * 60 * 60; // 8 hours
    await redis.set('news:latest', JSON.stringify(articles), { ex: TTL });
    console.log('Successfully cached news list');
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
    if (cached) {
      console.log('Retrieved cached news');
      return JSON.parse(cached);
    }
    console.log('No cached news found');
    return null;
  } catch (error) {
    console.error('Redis get news error:', error);
    return null;
  }
}

module.exports = {
  storeNewsList,
  getNewsList
};
