// lib/redis.js - Fixed for ES modules
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Simple hash for cache keys
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
export async function storeNewsList(articles) {
  try {
    const TTL = 8 * 60 * 60;
    await redis.set('news:latest', JSON.stringify(articles), { ex: TTL });
    return true;
  } catch (error) {
    console.error('Redis store news error:', error);
    return false;
  }
}

// Get cached news list
export async function getNewsList() {
  try {
    const cached = await redis.get('news:latest');
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    console.error('Redis get news error:', error);
    return null;
  }
}

// Cache AI analysis responses
export async function storeAIResponse(cacheKey, response) {
  try {
    const key = `impact:${hashKey(cacheKey)}`;
    const TTL = 8 * 60 * 60;
    await redis.set(key, response, { ex: TTL });
    return true;
  } catch (error) {
    console.error('Redis store AI response error:', error);
    return false;
  }
}

// Get cached AI analysis
export async function getAIResponse(cacheKey) {
  try {
    const key = `impact:${hashKey(cacheKey)}`;
    const cached = await redis.get(key);
    return cached || null;
  } catch (error) {
    console.error('Redis get AI response error:', error);
    return null;
  }
}
