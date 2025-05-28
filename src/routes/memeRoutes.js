const express = require('express');
const axios = require('axios');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const logger = require('../utils/logger');
const { trackApiKeyUsage } = require('../services/apiKeyService');
const fs = require('fs');
const path = require('path');

// Detect if we're running on a server (AWS, etc.) vs local environment
const isServerEnvironment = process.env.NODE_ENV === 'production' || 
                          process.env.IS_SERVER === 'true' ||
                          process.platform === 'linux';

// Log environment for debugging
logger.info(`Meme API running in ${isServerEnvironment ? 'SERVER' : 'LOCAL'} environment on ${process.platform}`);

// Implement in-memory caching for memes
const memeCache = {
  bySubreddit: {}, // Cache by subreddit
  timestamp: {}, // When each subreddit was last fetched
  randomMemes: [], // Cache for random memes endpoint
  randomTimestamp: 0 // When random memes were last fetched
};

// Cache expiration time (in milliseconds)
const CACHE_EXPIRATION = 30 * 1000; // 30 seconds

// Cache size limits
const MIN_CACHE_SIZE = 10; // Minimum memes in cache before refreshing
const MAX_CACHE_SIZE = 50; // Maximum memes to store in cache

// Add more variety to User-Agent to avoid Reddit blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (compatible; UniversalCircleApp/1.0; +https://universalcircle.in)'
];

// Free public proxies - rotate for better results
// Note: These are examples and may not work consistently; consider using a paid proxy service in production
const PUBLIC_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://cors-anywhere.herokuapp.com/'
];

// Local file paths for persistent caching (used as backup on server environments)
const CACHE_DIR = path.join(__dirname, '../../cache');
const RANDOM_CACHE_FILE = path.join(CACHE_DIR, 'random_memes_cache.json');
const SUBREDDIT_CACHE_DIR = path.join(CACHE_DIR, 'subreddits');

// Ensure cache directories exist
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(SUBREDDIT_CACHE_DIR)) {
    fs.mkdirSync(SUBREDDIT_CACHE_DIR, { recursive: true });
  }
} catch (error) {
  logger.warn(`Could not create cache directories: ${error.message}`);
}

// Near the top of the file, add this flag to track background fetch status
let isBatchFetchInProgress = false;
let lastBatchFetchTime = 0;

// Get a random User-Agent
function getRandomUserAgent() {
  const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[randomIndex];
}

// Get a random proxy URL
function getRandomProxy() {
  // Only use proxies in server environment
  if (!isServerEnvironment) {
    return '';
  }
  const randomIndex = Math.floor(Math.random() * PUBLIC_PROXIES.length);
  return PUBLIC_PROXIES[randomIndex];
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

// Load from disk cache if available
function loadCacheFromDisk() {
  try {
    // Try to load random memes cache
    if (fs.existsSync(RANDOM_CACHE_FILE)) {
      const cacheData = fs.readFileSync(RANDOM_CACHE_FILE, 'utf8');
      const parsedCache = JSON.parse(cacheData);
      memeCache.randomMemes = parsedCache.memes || [];
      memeCache.randomTimestamp = parsedCache.timestamp || 0;
      logger.info(`Loaded ${memeCache.randomMemes.length} random memes from disk cache`);
    }
    
    // Try to load subreddit caches
    if (fs.existsSync(SUBREDDIT_CACHE_DIR)) {
      const files = fs.readdirSync(SUBREDDIT_CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const subreddit = file.replace('.json', '');
          const cacheData = fs.readFileSync(path.join(SUBREDDIT_CACHE_DIR, file), 'utf8');
          const parsedCache = JSON.parse(cacheData);
          memeCache.bySubreddit[subreddit] = parsedCache.memes || [];
          memeCache.timestamp[subreddit] = parsedCache.timestamp || 0;
          logger.info(`Loaded ${memeCache.bySubreddit[subreddit].length} memes for r/${subreddit} from disk cache`);
        }
      }
    }
  } catch (error) {
    logger.error(`Error loading cache from disk: ${error.message}`);
  }
}

// Save cache to disk for persistence
function saveCacheToDisk(subreddit = null) {
  try {
    if (!subreddit) {
      // Save random memes cache
      fs.writeFileSync(
        RANDOM_CACHE_FILE,
        JSON.stringify({
          memes: memeCache.randomMemes,
          timestamp: memeCache.randomTimestamp
        })
      );
    } else {
      // Save specific subreddit cache
      fs.writeFileSync(
        path.join(SUBREDDIT_CACHE_DIR, `${subreddit}.json`),
        JSON.stringify({
          memes: memeCache.bySubreddit[subreddit] || [],
          timestamp: memeCache.timestamp[subreddit] || 0
        })
      );
    }
  } catch (error) {
    logger.error(`Error saving cache to disk: ${error.message}`);
  }
}

// Try to load cache at startup
loadCacheFromDisk();

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
    environment: isServerEnvironment ? 'server' : 'local',
    platform: process.platform,
    cache_status: {
      random_memes: memeCache.randomMemes.length,
      cached_subreddits: Object.keys(memeCache.bySubreddit).length,
      cache_size: Object.values(memeCache.bySubreddit).reduce((total, memes) => total + memes.length, 0) + memeCache.randomMemes.length
    },
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

// Special function for server environments that tries to use a proxy
async function fetchWithProxy(url) {
  if (!isServerEnvironment) {
    // On local environment, just use direct request
    return await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 15000
    });
  }
  
  // On server environment, try to use a proxy
  const proxy = getRandomProxy();
  const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
  
  try {
    return await axios.get(proxyUrl, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 20000 // Extended timeout for proxy requests
    });
  } catch (error) {
    logger.error(`Proxy fetch failed: ${error.message}`);
    
    // As a last resort, try direct request
    return await axios.get(url, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 15000
    });
  }
}

// Function to fetch a large batch of memes from multiple subreddits
async function fetchLargeBatchOfMemes() {
  // Prevent multiple concurrent batch operations
  if (isBatchFetchInProgress) {
    logger.info('Batch fetch already in progress, using existing cache');
    return memeCache.randomMemes.length > 0 ? memeCache.randomMemes : FALLBACK_MEMES;
  }
  
  // Rate limit batch operations to prevent overwhelming the server
  const now = Date.now();
  if (now - lastBatchFetchTime < 10000) { // 10 second cooldown between batch operations
    logger.info('Batch fetch requested too soon after previous fetch, using existing cache');
    return memeCache.randomMemes.length > 0 ? memeCache.randomMemes : FALLBACK_MEMES;
  }
  
  isBatchFetchInProgress = true;
  lastBatchFetchTime = now;
  
  try {
    logger.info(`Fetching large batch of ${MAX_CACHE_SIZE}+ memes from multiple subreddits`);
    const allMemes = [];
    const attemptedSubreddits = new Set();
    
    // Get only non-problematic subreddits
    const availableSubreddits = INDIAN_MEME_SUBREDDITS.filter(sr => !problematicSubreddits.has(sr));
    
    // If all subreddits are problematic, reset the problematic list and try again
    if (availableSubreddits.length < 3) {
      logger.warn('Too few available subreddits, resetting problematic list');
      problematicSubreddits.clear();
      // Re-filter available subreddits
      const refreshedSubreddits = INDIAN_MEME_SUBREDDITS.filter(sr => !problematicSubreddits.has(sr));
      
      if (refreshedSubreddits.length === 0) {
        logger.warn('All subreddits are problematic even after reset! Using fallback memes only.');
        return FALLBACK_MEMES;
      }
    }
    
    // Try with general memes subreddits if we're struggling to get content
    const allAvailableSubreddits = [
      ...INDIAN_MEME_SUBREDDITS.filter(sr => !problematicSubreddits.has(sr)),
      // Add more general meme subreddits that might work
      "memes", "dankmemes", "funny", "wholesomememes", "me_irl"
    ];
    
    // Remove duplicates
    const uniqueSubreddits = [...new Set(allAvailableSubreddits)];
    
    // Shuffle the available subreddits
    const shuffledSubreddits = getRandomItems(uniqueSubreddits, uniqueSubreddits.length);
    
    // Try to fetch from each subreddit until we have at least MAX_CACHE_SIZE memes or tried all subreddits
    // Do multiple rounds if needed to reach the target
    const maxAttempts = 3; // Try up to 3 rounds of fetching
    let attempts = 0;
    
    while (allMemes.length < MAX_CACHE_SIZE && attempts < maxAttempts) {
      attempts++;
      logger.info(`Batch fetch attempt ${attempts}/${maxAttempts}, current memes: ${allMemes.length}/${MAX_CACHE_SIZE}`);
      
      for (const subreddit of shuffledSubreddits) {
        if (allMemes.length >= MAX_CACHE_SIZE) break;
        if (attemptedSubreddits.has(subreddit)) continue;
        
        attemptedSubreddits.add(subreddit);
        logger.info(`Batch-fetching memes from r/${subreddit}, progress: ${allMemes.length}/${MAX_CACHE_SIZE}`);
        
        try {
          // Try to fetch up to 100 memes from this subreddit
          const result = await fetchSubredditPosts(subreddit);
          
          if (result.success) {
            // Extract meme data for each post and filter out duplicates
            const existingUrls = new Set(allMemes.map(meme => meme.image_url));
            const newMemes = result.posts
              .map(post => extractMemeData(post))
              .filter(meme => !existingUrls.has(meme.image_url));
            
            allMemes.push(...newMemes);
            logger.info(`Added ${newMemes.length} unique memes from ${subreddit}, total: ${allMemes.length}/${MAX_CACHE_SIZE}`);
          }
        } catch (error) {
          logger.error(`Error batch-fetching from ${subreddit}: ${error.message}`);
          // Continue to next subreddit
        }
      }
      
      // If we've tried all subreddits but still don't have enough memes,
      // we'll retry some of them in the next attempt with different sorting
      if (allMemes.length < MAX_CACHE_SIZE && attempts < maxAttempts) {
        // Reset attempted subreddits for next round but keep the ones that gave errors
        const failedSubreddits = [...attemptedSubreddits].filter(sr => problematicSubreddits.has(sr));
        attemptedSubreddits.clear();
        failedSubreddits.forEach(sr => attemptedSubreddits.add(sr));
      }
    }
    
    // If we couldn't get any memes, use fallbacks
    if (allMemes.length === 0) {
      logger.warn('Could not fetch any memes during batch operation! Using fallbacks.');
      return FALLBACK_MEMES;
    }
    
    // If we got some memes but not enough, fill the rest with fallbacks
    if (allMemes.length < MIN_CACHE_SIZE) {
      const remaining = MAX_CACHE_SIZE - allMemes.length;
      const fallbacks = getRandomItems(FALLBACK_MEMES, Math.min(remaining, FALLBACK_MEMES.length));
      allMemes.push(...fallbacks);
      logger.info(`Added ${fallbacks.length} fallback memes to complete the batch`);
    }
    
    logger.info(`Successfully fetched ${allMemes.length} memes in large batch operation after ${attempts} attempt(s)`);
    return allMemes;
  } catch (error) {
    logger.error(`Error in batch fetch operation: ${error.message}`);
    return memeCache.randomMemes.length > 0 ? memeCache.randomMemes : FALLBACK_MEMES;
  } finally {
    isBatchFetchInProgress = false;
  }
}

// Function to trigger a background cache refresh without blocking the response
function triggerBackgroundCacheRefresh() {
  if (isBatchFetchInProgress) {
    logger.info('Skipping background refresh as batch operation is already in progress');
    return;
  }
  
  // Use setTimeout to make this non-blocking
  setTimeout(async () => {
    try {
      logger.info('Starting background cache refresh');
      const batchMemes = await fetchLargeBatchOfMemes();
      
      // Update the cache with new memes
      if (batchMemes.length > 0) {
        // Add new memes to cache, avoiding duplicates
        let newCache = [];
        const existingUrls = new Set();
        
        // First add all new memes that aren't duplicates of each other
        for (const meme of batchMemes) {
          if (!existingUrls.has(meme.image_url)) {
            newCache.push(meme);
            existingUrls.add(meme.image_url);
          }
        }
        
        // Then add some old memes that aren't duplicates of new ones
        if (memeCache.randomMemes.length > 0) {
          const oldMemes = memeCache.randomMemes
            .filter(meme => !existingUrls.has(meme.image_url))
            .slice(0, Math.floor(MAX_CACHE_SIZE * 0.3)); // Keep up to 30% of old cache
          
          // Add non-duplicates
          for (const meme of oldMemes) {
            newCache.push(meme);
            existingUrls.add(meme.image_url);
          }
          
          logger.info(`Background refresh: added ${batchMemes.length} new memes, kept ${oldMemes.length} old memes, total unique: ${newCache.length}/${MAX_CACHE_SIZE}`);
        }
        
        // Ensure we don't exceed max size
        if (newCache.length > MAX_CACHE_SIZE) {
          newCache = newCache.slice(0, MAX_CACHE_SIZE);
        }
        
        // Update the cache
        memeCache.randomMemes = newCache;
        memeCache.randomTimestamp = Date.now();
        saveCacheToDisk(); // Save random cache
        
        // Log the size change
        logger.info(`Cache size changed from ${memeCache.randomMemes.length} to ${newCache.length}`);
      }
    } catch (error) {
      logger.error(`Error in background cache refresh: ${error.message}`);
    }
  }, 0);
}

// Special forced refresh function that ensures completely new content
function forcedVarietyRefresh() {
  if (isBatchFetchInProgress) {
    logger.info('Skipping forced variety refresh as batch operation is already in progress');
    return Promise.resolve(memeCache.randomMemes);
  }
  
  return new Promise(async (resolve) => {
    try {
      logger.info('Starting forced variety refresh to get completely new memes');
      
      // Temporarily clear problematic subreddits to try all sources again
      const oldProblematic = new Set([...problematicSubreddits]);
      problematicSubreddits.clear();
      
      // Get fresh memes with new sources
      const batchMemes = await fetchLargeBatchOfMemes();
      
      // Restore previously problematic subreddits
      oldProblematic.forEach(sr => problematicSubreddits.add(sr));
      
      if (batchMemes.length > 0) {
        // Replace the entire cache with new content
        memeCache.randomMemes = batchMemes;
        memeCache.randomTimestamp = Date.now();
        saveCacheToDisk();
        
        logger.info(`Forced variety refresh: replaced entire cache with ${batchMemes.length} new memes`);
        resolve(batchMemes);
      } else {
        logger.warn('Forced variety refresh failed to get new memes');
        resolve(memeCache.randomMemes);
      }
    } catch (error) {
      logger.error(`Error in forced variety refresh: ${error.message}`);
      resolve(memeCache.randomMemes);
    }
  });
}

// Function to fetch posts from a subreddit with improved error handling
async function fetchSubredditPosts(subreddit) {
  // Check cache first
  if (memeCache.bySubreddit[subreddit] && 
      memeCache.timestamp[subreddit] && 
      (Date.now() - memeCache.timestamp[subreddit] < CACHE_EXPIRATION)) {
    logger.info(`Using cached memes for subreddit: ${subreddit}`);
    return { success: true, posts: memeCache.bySubreddit[subreddit], fromCache: true };
  }
  
  try {
    // If this subreddit has been problematic, skip it
    if (problematicSubreddits.has(subreddit)) {
      logger.warn(`Skipping previously problematic subreddit: ${subreddit}`);
      return { success: false, message: 'Subreddit previously failed' };
    }
    
    logger.info(`Fetching memes from subreddit: ${subreddit}`);
    
    try {
      // Use a new axios instance with a fresh random User-Agent for each request
      const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=100`;
      const response = await fetchWithProxy(url);
      
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
      
      // Update cache
      memeCache.bySubreddit[subreddit] = posts;
      memeCache.timestamp[subreddit] = Date.now();
      
      // Save to disk cache
      saveCacheToDisk(subreddit);
      
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
    const url = `https://www.reddit.com/r/${subreddit}.json?limit=100`;
    const response = await fetchWithProxy(url);
    
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
    const url = `https://old.reddit.com/r/${subreddit}/top.json?sort=top&t=week&limit=50`;
    const response = await fetchWithProxy(url);
    
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
    // Check for force_refresh parameter
    const forceRefresh = req.query.force_refresh === 'true';
    
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
    
    // Skip cache if force_refresh is true
    if (forceRefresh) {
      logger.info(`Force refresh requested for subreddit ${subreddit}, bypassing cache`);
      memeCache.timestamp[subreddit] = 0; // Invalidate cache
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
      source: result.fromCache ? "cache" : "reddit",
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
    
    // Check for special parameters
    const forceRefresh = req.query.force_refresh === 'true';
    const forceVariety = req.query.force_variety === 'true'; // New parameter for complete refresh
    
    // Handle special force_variety parameter
    if (forceVariety) {
      logger.info('Force variety requested - getting completely new memes');
      const freshMemes = await forcedVarietyRefresh();
      const returnMemes = getRandomItems(freshMemes, count);
      
      return res.json({
        count: returnMemes.length,
        source: "forced_variety",
        cache_size: freshMemes.length,
        memes: returnMemes
      });
    }
    
    // FAST PATH: If we have any memes in cache, respond immediately while refreshing in background
    // This ensures users always get a quick response
    if (memeCache.randomMemes.length > 0) {
      const randomSelection = getRandomItems(memeCache.randomMemes, count);
      
      // Check if cache is stale or force refresh requested
      const isCacheStale = Date.now() - memeCache.randomTimestamp > CACHE_EXPIRATION;
      const needsRefresh = isCacheStale || forceRefresh || memeCache.randomMemes.length < MIN_CACHE_SIZE;
      
      // Trigger background refresh if needed, but don't wait for it
      if (needsRefresh) {
        logger.info(`Cache needs refresh (${memeCache.randomMemes.length}/${MIN_CACHE_SIZE}, age: ${Math.floor((Date.now() - memeCache.randomTimestamp)/1000)}s), triggering background update`);
        triggerBackgroundCacheRefresh();
      }
      
      // Return immediately with what we have
      return res.json({
        count: randomSelection.length,
        source: "cache" + (needsRefresh ? "_refreshing" : ""),
        cache_size: memeCache.randomMemes.length,
        cache_age_seconds: Math.floor((Date.now() - memeCache.randomTimestamp)/1000),
        needs_variety: memeCache.randomTimestamp < Date.now() - (60 * 60 * 1000), // Suggest variety refresh after 1 hour
        memes: randomSelection
      });
    }
    
    // SLOW PATH: Only reached on first run or if cache is completely empty
    logger.info('Cache is empty, fetching initial batch of memes (may take a moment)');
    
    // For first run or completely empty cache, we need to wait for the fetch
    const batchMemes = await fetchLargeBatchOfMemes();
    
    // Replace cache with the new batch
    memeCache.randomMemes = batchMemes;
    memeCache.randomTimestamp = Date.now();
    saveCacheToDisk();
    
    // Return the requested number of memes
    const returnMemes = getRandomItems(batchMemes, count);
    
    return res.json({
      count: returnMemes.length,
      source: "fresh_batch",
      cache_size: batchMemes.length,
      memes: returnMemes
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

// Also expose a variety endpoint for completely refreshed content
router.get('/variety', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count || DEFAULT_MEME_COUNT), 25);
    
    // Perform a forced variety refresh
    logger.info('Variety endpoint called - getting completely new memes');
    const freshMemes = await forcedVarietyRefresh();
    const returnMemes = getRandomItems(freshMemes, count);
    
    return res.json({
      count: returnMemes.length,
      source: "variety_endpoint",
      cache_size: freshMemes.length,
      memes: returnMemes
    });
  } catch (error) {
    logger.error('Error in variety endpoint:', error.message);
    
    // Return fallbacks on error
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