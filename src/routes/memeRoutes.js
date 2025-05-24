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

// List of Indian meme subreddits
const INDIAN_MEME_SUBREDDITS = [
  "IndianDankMemes", 
  "IndianMeyMeys", 
  "memes", 
  "dankindianmemes", 
  "PoliticalIndianMemes"
];

// Default number of memes to return
const DEFAULT_MEME_COUNT = 10;

// Public endpoint to get API status (no API key required)
router.get('/status', (req, res) => {
  return res.json({
    success: true,
    message: 'Indian Meme API is operational',
    endpoints: [
      {
        path: '/api/memes',
        method: 'GET',
        description: 'Get multiple memes from popular Indian subreddits',
        requiresApiKey: true,
        query_params: {
          count: "Number of memes to return (default: 10, max: 25)"
        }
      },
      {
        path: '/api/memes/:subreddit',
        method: 'GET',
        description: 'Get multiple memes from a specific subreddit',
        requiresApiKey: true,
        query_params: {
          count: "Number of memes to return (default: 10, max: 25)"
        }
      }
    ],
    supported_subreddits: INDIAN_MEME_SUBREDDITS
  });
});

// Function to extract meme data from Reddit post
function extractMemeData(post) {
  return {
    title: post.data.title,
    image_url: post.data.url,
    author: post.data.author,
    subreddit: post.data.subreddit,
    upvotes: post.data.ups,
    permalink: `https://reddit.com${post.data.permalink}`,
    created_utc: post.data.created_utc,
    nsfw: post.data.over_18,
    post_hint: post.data.post_hint || 'image'
  };
}

// Function to get multiple random items from an array
function getRandomItems(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// All other routes require API key authentication
router.use(apiKeyAuth);

// Get memes from a specific subreddit
router.get('/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;
    // Get count parameter, default to DEFAULT_MEME_COUNT, max 25
    const count = Math.min(parseInt(req.query.count || DEFAULT_MEME_COUNT), 25);
    
    logger.info(`Fetching ${count} memes from subreddit: ${subreddit}`);
    
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
    
    // Get random posts based on requested count
    const memeCount = Math.min(count, posts.length);
    const randomPosts = getRandomItems(posts, memeCount);
    
    // Extract meme data for each post
    const memes = randomPosts.map(post => extractMemeData(post));
    
    logger.info(`Successfully fetched ${memes.length} memes from subreddit: ${subreddit}`);
    
    // Return array of memes
    return res.json({
      subreddit,
      count: memes.length,
      memes
    });
  } catch (error) {
    logger.error('Error fetching memes:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching memes from Reddit',
      error: error.message
    });
  }
});

// Get random memes from Indian meme subreddits
router.get('/', async (req, res) => {
  try {
    // Get count parameter, default to DEFAULT_MEME_COUNT, max 25
    const count = Math.min(parseInt(req.query.count || DEFAULT_MEME_COUNT), 25);
    
    // For multiple memes, we'll randomize across different subreddits
    // We'll collect memes from multiple subreddits if needed
    const memesNeeded = count;
    const allMemes = [];
    const attemptedSubreddits = new Set();
    
    // Shuffle the subreddits to randomize where we get memes from
    const shuffledSubreddits = getRandomItems(INDIAN_MEME_SUBREDDITS, INDIAN_MEME_SUBREDDITS.length);
    
    // Try to fetch from each subreddit until we have enough memes
    for (const subreddit of shuffledSubreddits) {
      if (allMemes.length >= memesNeeded) break;
      if (attemptedSubreddits.has(subreddit)) continue;
      
      try {
        attemptedSubreddits.add(subreddit);
        logger.info(`Fetching memes from Indian subreddit: ${subreddit}`);
        
        const response = await axiosInstance.get(`https://www.reddit.com/r/${subreddit}/hot.json?limit=100`);
        
        if (!response.data?.data?.children?.length) {
          logger.warn(`No memes found in subreddit: ${subreddit}`);
          continue;
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
          continue;
        }
        
        // Determine how many more memes we need
        const memesStillNeeded = memesNeeded - allMemes.length;
        const memeCountFromThisSubreddit = Math.min(memesStillNeeded, posts.length);
        
        // Get random posts from this subreddit
        const randomPosts = getRandomItems(posts, memeCountFromThisSubreddit);
        
        // Extract and add memes to our collection
        randomPosts.forEach(post => {
          allMemes.push(extractMemeData(post));
        });
        
        logger.info(`Added ${randomPosts.length} memes from ${subreddit}, total: ${allMemes.length}/${memesNeeded}`);
      } catch (error) {
        logger.error(`Error fetching from subreddit ${subreddit}:`, error.message);
        // Continue to next subreddit on error
      }
    }
    
    // If we couldn't get any memes
    if (allMemes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Could not find any valid memes in the specified subreddits'
      });
    }
    
    logger.info(`Successfully fetched ${allMemes.length} memes from Indian subreddits`);
    
    // Return the collection of memes
    return res.json({
      count: allMemes.length,
      memes: allMemes
    });
  } catch (error) {
    logger.error('Error fetching memes:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching memes from Reddit',
      error: error.message
    });
  }
});

module.exports = router;