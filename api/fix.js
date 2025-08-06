const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  try {
    // Delete the corrupted news cache
    await redis.del('news:latest');
    res.status(200).json({ message: 'Fixed corrupted cache' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
