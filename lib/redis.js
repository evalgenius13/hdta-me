// lib/redis.js - Simple Redis utilities
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Simple hash function for cache keys
function hashKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Cache AI analysis responses
async function storeAnalysis(cacheKey, analysis) {
  try {
    const key = `analysis:${hashKey(cacheKey)}`;
    const TTL = 24 * 60 * 60; // 24 hours
    await redis.setex(key, TTL, analysis);
    return true;
  } catch (error) {
    console.error('Redis store error:', error);
    return false;
  }
}

// Get cached AI analysis
async function getAnalysis(cacheKey) {
  try {
    const key = `analysis:${hashKey(cacheKey)}`;
    return await redis.get(key);
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

// Cache news list for faster page loads
async function storeNewsList(articles) {
  try {
    const TTL = 8 * 60 * 60; // 8 hours - policy news moves very slowly
    await redis.setex('news:latest', TTL, JSON.stringify(articles));
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

// Clear cache (for development)
async function clearCache() {
  try {
    const keys = await redis.keys('*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  } catch (error) {
    console.error('Redis clear error:', error);
    return 0;
  }
}

module.exports = {
  storeAnalysis,
  getAnalysis,
  storeNewsList,
  getNewsList,
  clearCache
};
