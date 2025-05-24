const express = require('express');
const axios = require('axios');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const logger = require('../utils/logger');

// Configure axios defaults for Reddit API with improved User-Agent
const axiosInstance = axios.create({
  headers: {
    // More detailed User-Agent to avoid Reddit API blocking
    'User-Agent': 'UniversalCircleApp/1.0 (Node.js; +https://universalcircle.in; admin@universalcircle.in)'
  },
  // Add timeout to avoid hanging requests
  timeout: 5000
});

// List of Indian meme subreddits with fallbacks
const INDIAN_MEME_SUBREDDITS = [
  "IndianDankMemes", 
  "IndianMeyMeys", 
  "memes", 
  "dankindianmemes", 
  "PoliticalIndianMemes",
  "indiameme",
  "desimemes",
  "SaimanSays" // Additional popular Indian meme subreddits as fallbacks
];

// Default number of memes to return
const DEFAULT_MEME_COUNT = 10;

// Track problematic subreddits to avoid them in future requests during this server session
const problematicSubreddits = new Set();

// Public endpoint to get API status (no API key required)
router.get('/status', (req, res) => {
  // Filter out any problematic subreddits from the response
  const availableSubreddits = INDIAN_MEME_SUBREDDITS.filter(sr => !problematicSubreddits.has(sr));
  
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
    supported_subreddits: availableSubreddits
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

// Function to fetch posts from a subreddit with improved error handling
async function fetchSubredditPosts(subreddit) {
  try {
    // If this subreddit has been problematic, skip it
    if (problematicSubreddits.has(subreddit)) {
      logger.warn(`Skipping previously problematic subreddit: ${subreddit}`);
      return { success: false, message: 'Subreddit previously failed' };
    }
    
    logger.info(`Fetching memes from subreddit: ${subreddit}`);
    
    const response = await axiosInstance.get(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=100`,
      { validateStatus: status => status < 500 } // Accept non-5xx responses to handle them explicitly
    );
    
    // Handle different status codes
    if (response.status !== 200) {
      if (response.status === 403) {
        logger.warn(`Subreddit ${subreddit} is restricted or private. Adding to problematic list.`);
        problematicSubreddits.add(subreddit);
      } else if (response.status === 404) {
        logger.warn(`Subreddit ${subreddit} not found. Adding to problematic list.`);
        problematicSubreddits.add(subreddit);
      } else {
        logger.warn(`Unexpected status ${response.status} from subreddit ${subreddit}`);
      }
      return { success: false, status: response.status, message: `Reddit API returned status ${response.status}` };
    }
    
    if (!response.data?.data?.children?.length) {
      logger.warn(`No posts found in subreddit: ${subreddit}`);
      return { success: false, message: 'No posts found' };
    }
    
    // Filter for image posts
    const posts = response.data.data.children.filter(post => 
      !post.data.stickied && 
      (post.data.url.endsWith('.jpg') || 
      post.data.url.endsWith('.png') || 
      post.data.url.endsWith('.gif') || 
      post.data.url.endsWith('.jpeg') ||
      post.data.url.includes('i.redd.it')) // Include Reddit-hosted images that might not have extensions
    );
    
    if (posts.length === 0) {
      logger.warn(`No valid image posts found in subreddit: ${subreddit}`);
      return { success: false, message: 'No valid image posts found' };
    }
    
    return { success: true, posts };
  } catch (error) {
    logger.error(`Error fetching from subreddit ${subreddit}: ${error.message}`);
    
    // If the request was blocked or failed, mark this subreddit as problematic
    if (error.response?.status === 403 || error.response?.status === 404) {
      problematicSubreddits.add(subreddit);
    }
    
    return { success: false, message: error.message };
  }
}

// All other routes require API key authentication
router.use(apiKeyAuth);

// Get memes from a specific subreddit
router.get('/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;
    // Get count parameter, default to DEFAULT_MEME_COUNT, max 25
    const count = Math.min(parseInt(req.query.count || DEFAULT_MEME_COUNT), 25);
    
    // If this is a known problematic subreddit
    if (problematicSubreddits.has(subreddit)) {
      return res.status(403).json({
        success: false,
        message: `Subreddit r/${subreddit} is restricted, private, or cannot be accessed by the API`
      });
    }
    
    const result = await fetchSubredditPosts(subreddit);
    
    if (!result.success) {
      return res.status(result.status || 404).json({
        success: false,
        message: result.message || `Failed to fetch memes from subreddit: ${subreddit}`
      });
    }
    
    // Get random posts based on requested count
    const memeCount = Math.min(count, result.posts.length);
    const randomPosts = getRandomItems(result.posts, memeCount);
    
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
    
    // Get only non-problematic subreddits
    const availableSubreddits = INDIAN_MEME_SUBREDDITS.filter(sr => !problematicSubreddits.has(sr));
    
    // If all subreddits are problematic, return an error
    if (availableSubreddits.length === 0) {
      return res.status(503).json({
        success: false,
        message: 'No available subreddits to fetch memes from. Please try again later.'
      });
    }
    
    // Shuffle the available subreddits to randomize where we get memes from
    const shuffledSubreddits = getRandomItems(availableSubreddits, availableSubreddits.length);
    
    // Try to fetch from each subreddit until we have enough memes
    for (const subreddit of shuffledSubreddits) {
      if (allMemes.length >= memesNeeded) break;
      if (attemptedSubreddits.has(subreddit)) continue;
      
      attemptedSubreddits.add(subreddit);
      const result = await fetchSubredditPosts(subreddit);
      
      if (!result.success) {
        continue; // Try next subreddit
      }
      
      // Determine how many more memes we need
      const memesStillNeeded = memesNeeded - allMemes.length;
      const memeCountFromThisSubreddit = Math.min(memesStillNeeded, result.posts.length);
      
      // Get random posts from this subreddit
      const randomPosts = getRandomItems(result.posts, memeCountFromThisSubreddit);
      
      // Extract and add memes to our collection
      randomPosts.forEach(post => {
        allMemes.push(extractMemeData(post));
      });
      
      logger.info(`Added ${randomPosts.length} memes from ${subreddit}, total: ${allMemes.length}/${memesNeeded}`);
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