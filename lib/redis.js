// lib/redis.js - Enhanced Redis with AI response caching
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Hash function for cache keys
function hashKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

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

// Cache AI analysis responses
async function storeAIResponse(cacheKey, response) {
  try {
    const key = `impact:${hashKey(cacheKey)}`;
    const TTL = 8 * 60 * 60; // 8 hours
    await redis.set(key, response, { ex: TTL });
    console.log('Cached AI response');
    return true;
  } catch (error) {
    console.error('Redis store AI response error:', error);
    return false;
  }
}

// Get cached AI analysis
async function getAIResponse(cacheKey) {
  try {
    const key = `impact:${hashKey(cacheKey)}`;
    const cached = await redis.get(key);
    if (cached) {
      console.log('Retrieved cached AI response');
      return cached;
    }
    return null;
  } catch (error) {
    console.error('Redis get AI response error:', error);
    return null;
  }
}

module.exports = {
  storeNewsList,
  getNewsList,
  storeAIResponse,
  getAIResponse
};
