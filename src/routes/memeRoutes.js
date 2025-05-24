const express = require('express');
const axios = require('axios');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const logger = require('../utils/logger');

// Configure axios defaults for Reddit API
const axiosInstance = axios.create({
  headers: {
    'User-Agent': 'universalcircle-app/1.0 (by /u/universalcircle)'
  }
});

// Public endpoint to get API status (no API key required)
router.get('/status', (req, res) => {
  return res.json({
    success: true,
    message: 'Meme API is operational',
    endpoints: [
      {
        path: '/api/memes',
        method: 'GET',
        description: 'Get a random meme from popular subreddits',
        requiresApiKey: true
      },
      {
        path: '/api/memes/:subreddit',
        method: 'GET',
        description: 'Get a random meme from a specific subreddit',
        requiresApiKey: true
      }
    ]
  });
});

// All other routes require API key authentication
router.use(apiKeyAuth);

// Get a meme from a specific subreddit
router.get('/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;
    logger.info(`Fetching meme from subreddit: ${subreddit}`);
    
    const response = await axiosInstance.get(`https://www.reddit.com/r/${subreddit}/hot.json?limit=100`);
    
    if (!response.data || !response.data.data || !response.data.data.children || response.data.data.children.length === 0) {
      logger.warn(`No memes found in subreddit: ${subreddit}`);
      return res.status(404).json({
        success: false,
        message: `No memes found in subreddit: ${subreddit}`
      });
    }
    
    const posts = response.data.data.children.filter(post => 
      !post.data.stickied && 
      (post.data.url.endsWith('.jpg') || 
      post.data.url.endsWith('.png') || 
      post.data.url.endsWith('.gif') || 
      post.data.url.endsWith('.jpeg'))
    );
    
    if (posts.length === 0) {
      logger.warn(`No valid image posts found in subreddit: ${subreddit}`);
      return res.status(404).json({
        success: false,
        message: `No valid image posts found in subreddit: ${subreddit}`
      });
    }
    
    // Get a truly random post from the filtered list
    const randomIndex = Math.floor(Math.random() * posts.length);
    const randomPost = posts[randomIndex];
    
    const meme = {
      title: randomPost.data.title,
      url: randomPost.data.url,
      author: randomPost.data.author,
      subreddit: randomPost.data.subreddit,
      ups: randomPost.data.ups,
      permalink: `https://reddit.com${randomPost.data.permalink}`
    };
    
    logger.info(`Successfully fetched meme: ${meme.title}`);
    return res.json({
      success: true,
      meme,
      subreddit,
      request_id: Date.now().toString(36) + Math.random().toString(36).substr(2)
    });
  } catch (error) {
    logger.error('Error fetching meme:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching meme from Reddit',
      error: error.message
    });
  }
});

// Get a random meme from popular meme subreddits
router.get('/', async (req, res) => {
  try {
    const subreddits = [
      'memes', 
      'dankmemes', 
      'wholesomememes', 
      'me_irl', 
      'funny',
      'IndianDankMemes',
      'ProgrammerHumor',
      'AdviceAnimals',
      'ComedyCemetery',
      'terriblefacebookmemes'
    ];
    
    // Get a truly random subreddit
    const randomIndex = Math.floor(Math.random() * subreddits.length);
    const randomSubreddit = subreddits[randomIndex];
    
    logger.info(`Fetching random meme from subreddit: ${randomSubreddit}`);
    
    const response = await axiosInstance.get(`https://www.reddit.com/r/${randomSubreddit}/hot.json?limit=100`);
    
    if (!response.data || !response.data.data || !response.data.data.children || response.data.data.children.length === 0) {
      logger.warn(`No memes found in subreddit: ${randomSubreddit}`);
      return res.status(404).json({
        success: false,
        message: `No memes found in subreddit: ${randomSubreddit}`
      });
    }
    
    const posts = response.data.data.children.filter(post => 
      !post.data.stickied && 
      (post.data.url.endsWith('.jpg') || 
      post.data.url.endsWith('.png') || 
      post.data.url.endsWith('.gif') || 
      post.data.url.endsWith('.jpeg'))
    );
    
    if (posts.length === 0) {
      logger.warn(`No valid image posts found in subreddit: ${randomSubreddit}`);
      return res.status(404).json({
        success: false,
        message: `No valid image posts found in subreddit: ${randomSubreddit}`
      });
    }
    
    // Get a truly random post from the filtered list
    const randomPostIndex = Math.floor(Math.random() * posts.length);
    const randomPost = posts[randomPostIndex];
    
    const meme = {
      title: randomPost.data.title,
      url: randomPost.data.url,
      author: randomPost.data.author,
      subreddit: randomPost.data.subreddit,
      ups: randomPost.data.ups,
      permalink: `https://reddit.com${randomPost.data.permalink}`
    };
    
    logger.info(`Successfully fetched meme: ${meme.title}`);
    return res.json({
      success: true,
      meme,
      subreddit: randomSubreddit,
      request_id: Date.now().toString(36) + Math.random().toString(36).substr(2)
    });
  } catch (error) {
    logger.error('Error fetching meme:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching meme from Reddit',
      error: error.message
    });
  }
});

module.exports = router;