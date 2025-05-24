const express = require('express');
const axios = require('axios');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const logger = require('../utils/logger');
const { trackApiKeyUsage } = require('../services/apiKeyService');

// Add more variety to User-Agent to avoid Reddit blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (compatible; UniversalCircleApp/1.0; +https://universalcircle.in)'
];

// Get a random User-Agent
function getRandomUserAgent() {
  const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[randomIndex];
}

// Configure axios defaults for Reddit API with improved User-Agent
const axiosInstance = axios.create({
  headers: {
    // More detailed User-Agent to avoid Reddit API blocking
    'User-Agent': getRandomUserAgent()
  },
  // Add timeout to avoid hanging requests
  timeout: 15000 // Extended timeout for slower connections
});

// Fallback memes for when Reddit API fails completely
const FALLBACK_MEMES = [
  {
    title: "When you finally debug that error in production",
    image_url: "https://i.imgur.com/gE8hDnY.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 999,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "Indian parents when you get 99% instead of 100%",
    image_url: "https://i.imgur.com/FPBVI24.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 888,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "When someone asks if you're getting enough sleep",
    image_url: "https://i.imgur.com/DqVyJft.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 777,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "The face you make when someone says 'just one more quick change'",
    image_url: "https://i.imgur.com/K9qRmwd.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 666,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "Trying to explain my code to non-developers",
    image_url: "https://i.imgur.com/kxG3b3H.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 555,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "When the client asks for a small change that breaks everything",
    image_url: "https://i.imgur.com/9mHzW0k.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 444,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  },
  {
    title: "That feeling when your code works on the first try",
    image_url: "https://i.imgur.com/vYGLKIQ.jpg",
    author: "UniversalCircle",
    subreddit: "fallback",
    upvotes: 333,
    permalink: "https://universalcircle.in",
    created_utc: Math.floor(Date.now() / 1000),
    nsfw: false,
    post_hint: "image"
  }
];

// List of Indian meme subreddits with fallbacks - prioritized by reliability
const INDIAN_MEME_SUBREDDITS = [
  "IndianDankMemes",  // Most reliable based on logs
  "memes",            // General memes as fallback
  "IndianMeyMeys",
  "indiameme",
  "SaimanSays",
  "dankindianmemes",
  "india",
  "delhi",
  "mumbai",
  "bangalore",
  "bollywood",
  "cricket",
  "desimemes",
  "indianpeoplefacebook",
  "PoliticalIndianMemes",
  "BollyBlindsNGossip",
  "Indiangirlsontinder"
];

// Default number of memes to return
const DEFAULT_MEME_COUNT = 10;

// Track problematic subreddits to avoid them in future requests during this server session
const problematicSubreddits = new Set();

// Reset problematic subreddits every 30 minutes to give them another chance
// This is reduced from 1 hour to improve recovery speed
setInterval(() => {
  const count = problematicSubreddits.size;
  if (count > 0) {
    logger.info(`Resetting ${count} problematic subreddits to give them another chance`);
    problematicSubreddits.clear();
  }
}, 30 * 60 * 1000); // 30 minutes

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
    supported_subreddits: availableSubreddits,
    problematic_count: problematicSubreddits.size,
    fallback_count: FALLBACK_MEMES.length
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

// Third-level fallback method using a different Reddit URL structure
async function fetchSubredditPostsLastResort(subreddit) {
  try {
    // If this subreddit has been problematic, skip it
    if (problematicSubreddits.has(subreddit)) {
      logger.warn(`Skipping previously problematic subreddit: ${subreddit}`);
      return { success: false, message: 'Subreddit previously failed' };
    }
    
    logger.info(`Fetching memes from subreddit: ${subreddit} (last resort method)`);
    
    // Try using Reddit's old interface which might have different rate limiting
    const response = await axios.get(
      `https://old.reddit.com/r/${subreddit}/top.json?sort=top&t=week&limit=50`,
      { 
        timeout: 15000,
        headers: {
          'User-Agent': getRandomUserAgent()
        },
        validateStatus: status => status < 500
      }
    );
    
    // Handle different status codes
    if (response.status !== 200) {
      if (response.status === 403 || response.status === 404) {
        logger.warn(`Subreddit ${subreddit} is restricted or not found in last resort attempt. Adding to problematic list.`);
        problematicSubreddits.add(subreddit);
      } else {
        logger.warn(`Unexpected status ${response.status} from subreddit ${subreddit} in last resort attempt`);
      }
      return { success: false, status: response.status, message: `Reddit API returned status ${response.status}` };
    }
    
    if (!response.data?.data?.children?.length) {
      logger.warn(`No posts found in subreddit: ${subreddit} (last resort method)`);
      return { success: false, message: 'No posts found' };
    }
    
    // Filter for image posts with more flexible criteria
    const posts = response.data.data.children.filter(post => 
      !post.data.stickied && 
      (post.data.url.endsWith('.jpg') || 
       post.data.url.endsWith('.png') || 
       post.data.url.endsWith('.gif') || 
       post.data.url.endsWith('.jpeg') ||
       post.data.url.includes('i.redd.it') ||
       post.data.url.includes('imgur.com') ||
       (post.data.post_hint && post.data.post_hint.includes('image')))
    );
    
    if (posts.length === 0) {
      logger.warn(`No valid image posts found in subreddit: ${subreddit} (last resort method)`);
      return { success: false, message: 'No valid image posts found' };
    }
    
    return { success: true, posts };
  } catch (error) {
    logger.error(`Error fetching from subreddit ${subreddit} (last resort): ${error.message}`);
    
    // If the request was blocked or failed, mark this subreddit as problematic
    if (error.response?.status === 403 || error.response?.status === 404) {
      problematicSubreddits.add(subreddit);
    }
    
    return { success: false, message: error.message };
  }
}

// Alternative method to fetch Reddit content using .json approach
async function fetchSubredditPostsAlternative(subreddit) {
  try {
    // If this subreddit has been problematic, skip it
    if (problematicSubreddits.has(subreddit)) {
      logger.warn(`Skipping previously problematic subreddit: ${subreddit}`);
      return { success: false, message: 'Subreddit previously failed' };
    }
    
    logger.info(`Fetching memes from subreddit: ${subreddit} (alternative method)`);
    
    // Try the alternative approach using the public .json extension
    const response = await axios.get(
      `https://www.reddit.com/r/${subreddit}.json?limit=100`,
      { 
        timeout: 15000,
        headers: {
          'User-Agent': getRandomUserAgent()
        },
        validateStatus: status => status < 500
      }
    );
    
    // Handle different status codes
    if (response.status !== 200) {
      if (response.status === 403 || response.status === 404) {
        logger.warn(`Subreddit ${subreddit} is restricted or not found. Trying last resort method before giving up.`);
        return await fetchSubredditPostsLastResort(subreddit);
      } else {
        logger.warn(`Unexpected status ${response.status} from subreddit ${subreddit}. Trying last resort method.`);
        return await fetchSubredditPostsLastResort(subreddit);
      }
    }
    
    if (!response.data?.data?.children?.length) {
      logger.warn(`No posts found in subreddit: ${subreddit}. Trying last resort method.`);
      return await fetchSubredditPostsLastResort(subreddit);
    }
    
    // Filter for image posts
    const posts = response.data.data.children.filter(post => 
      !post.data.stickied && 
      (post.data.url.endsWith('.jpg') || 
      post.data.url.endsWith('.png') || 
      post.data.url.endsWith('.gif') || 
      post.data.url.endsWith('.jpeg') ||
      post.data.url.includes('i.redd.it') ||
      post.data.url.includes('imgur.com'))
    );
    
    if (posts.length === 0) {
      logger.warn(`No valid image posts found in subreddit: ${subreddit}. Trying last resort method.`);
      return await fetchSubredditPostsLastResort(subreddit);
    }
    
    return { success: true, posts };
  } catch (error) {
    logger.error(`Error fetching from subreddit ${subreddit} (alternative): ${error.message}`);
    
    // Try the last resort method before giving up
    logger.warn(`Alternative method failed for ${subreddit}, trying last resort method...`);
    return await fetchSubredditPostsLastResort(subreddit);
  }
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
    
    try {
      // Use a new axios instance with a fresh random User-Agent for each request
      const tempAxios = axios.create({
        headers: {
          'User-Agent': getRandomUserAgent()
        },
        timeout: 15000
      });
      
      // First try the standard approach
      const response = await tempAxios.get(
        `https://www.reddit.com/r/${subreddit}/hot.json?limit=100`,
        { validateStatus: status => status < 500 }
      );
      
      // Handle different status codes
      if (response.status !== 200) {
        // If standard approach fails, try alternative
        logger.warn(`Standard fetch failed for ${subreddit} with status ${response.status}, trying alternative...`);
        return await fetchSubredditPostsAlternative(subreddit);
      }
      
      if (!response.data?.data?.children?.length) {
        logger.warn(`No posts found in subreddit: ${subreddit}`);
        return await fetchSubredditPostsAlternative(subreddit);
      }
      
      // Filter for image posts
      const posts = response.data.data.children.filter(post => 
        !post.data.stickied && 
        (post.data.url.endsWith('.jpg') || 
        post.data.url.endsWith('.png') || 
        post.data.url.endsWith('.gif') || 
        post.data.url.endsWith('.jpeg') ||
        post.data.url.includes('i.redd.it') ||
        post.data.url.includes('imgur.com'))
      );
      
      if (posts.length === 0) {
        logger.warn(`No valid image posts found in subreddit: ${subreddit}`);
        return await fetchSubredditPostsAlternative(subreddit);
      }
      
      return { success: true, posts };
      
    } catch (primaryError) {
      // If the standard approach fails completely, try the alternative
      logger.warn(`Standard fetch threw error for ${subreddit}: ${primaryError.message}, trying alternative...`);
      return await fetchSubredditPostsAlternative(subreddit);
    }
    
  } catch (error) {
    logger.error(`Error fetching from subreddit ${subreddit}: ${error.message}`);
    
    // If the request was blocked or failed, mark this subreddit as problematic
    if (error.response?.status === 403 || error.response?.status === 404) {
      problematicSubreddits.add(subreddit);
    }
    
    return { success: false, message: error.message };
  }
}

// Custom middleware to track API key usage
const trackUsage = async (req, res, next) => {
  // Store the original json method
  const originalJson = res.json;
  
  // Override the json method
  res.json = function(data) {
    // Track API key usage before sending response
    try {
      if (req.apiKey) {
        // Track usage asynchronously without waiting
        trackApiKeyUsage(req.apiKey).catch(err => {
          logger.error('Error tracking API key usage in middleware:', err);
        });
      }
    } catch (error) {
      logger.error('Error in trackUsage middleware:', error);
    }
    
    // Call the original json method
    return originalJson.call(this, data);
  };
  
  next();
};

// All routes require API key authentication and usage tracking
router.use(apiKeyAuth);
router.use(trackUsage);

// Get memes from a specific subreddit
router.get('/:subreddit', async (req, res) => {
  try {
    const subreddit = req.params.subreddit;
    // Get count parameter, default to DEFAULT_MEME_COUNT, max 25
    const count = Math.min(parseInt(req.query.count || DEFAULT_MEME_COUNT), 25);
    
    // If this is a known problematic subreddit
    if (problematicSubreddits.has(subreddit)) {
      // Instead of error, use fallback memes
      logger.warn(`Requested problematic subreddit ${subreddit}, using fallback memes`);
      
      const fallbackCount = Math.min(count, FALLBACK_MEMES.length);
      const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
      
      return res.json({
        count: fallbackMemes.length,
        source: "fallback_problematic_subreddit",
        requested_subreddit: subreddit,
        memes: fallbackMemes
      });
    }
    
    const result = await fetchSubredditPosts(subreddit);
    
    if (!result.success) {
      // Use fallback memes instead of returning error
      logger.warn(`Failed to fetch from ${subreddit}, using fallback memes`);
      
      const fallbackCount = Math.min(count, FALLBACK_MEMES.length);
      const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
      
      return res.json({
        count: fallbackMemes.length,
        source: "fallback_fetch_failed",
        requested_subreddit: subreddit,
        error_details: result.message,
        memes: fallbackMemes
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
    
    // Even for unexpected errors, use fallback memes
    const fallbackCount = Math.min(DEFAULT_MEME_COUNT, FALLBACK_MEMES.length);
    const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
    
    return res.json({
      count: fallbackMemes.length,
      source: "fallback_error",
      memes: fallbackMemes,
      error_details: error.message
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
    
    // If all subreddits are problematic or we're running in a degraded state, use fallback memes
    if (availableSubreddits.length === 0) {
      logger.warn(`All subreddits are problematic! Using fallback memes.`);
      
      // Use our static fallback memes
      const fallbackCount = Math.min(count, FALLBACK_MEMES.length);
      const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
      
      return res.json({
        count: fallbackMemes.length,
        source: "fallback_all_problematic",
        memes: fallbackMemes
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
    
    // If we couldn't get any memes from Reddit, use fallback memes
    if (allMemes.length === 0) {
      logger.warn(`Could not fetch any memes from Reddit! Using fallback memes.`);
      
      // Use our static fallback memes
      const fallbackCount = Math.min(count, FALLBACK_MEMES.length);
      const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
      
      return res.json({
        count: fallbackMemes.length,
        source: "fallback_fetch_failed",
        memes: fallbackMemes
      });
    }
    
    // If we got some memes but not enough, fill the rest with fallbacks
    if (allMemes.length < memesNeeded && FALLBACK_MEMES.length > 0) {
      logger.info(`Only got ${allMemes.length}/${memesNeeded} memes, adding fallbacks to complete the request`);
      
      const needFallbacks = memesNeeded - allMemes.length;
      const fallbackCount = Math.min(needFallbacks, FALLBACK_MEMES.length);
      const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
      
      // Add fallbacks to the collection
      allMemes.push(...fallbackMemes);
      
      logger.info(`Successfully fetched ${allMemes.length} memes (${fallbackCount} from fallbacks)`);
      
      return res.json({
        count: allMemes.length,
        source: "mixed",
        fallback_count: fallbackCount,
        memes: allMemes
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
    
    // Even in case of catastrophic error, still return fallback memes
    const fallbackCount = Math.min(DEFAULT_MEME_COUNT, FALLBACK_MEMES.length);
    const fallbackMemes = getRandomItems(FALLBACK_MEMES, fallbackCount);
    
    return res.json({
      count: fallbackMemes.length,
      source: "fallback_error",
      memes: fallbackMemes,
      error_details: error.message
    });
  }
});

module.exports = router;