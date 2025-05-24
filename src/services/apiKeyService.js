const crypto = require('crypto');
const supabase = require('../config/database');
const logger = require('../utils/logger');

/**
 * Generate a new API key
 * @param {string} userId - The user ID associated with this API key
 * @param {string} name - A friendly name for the API key
 * @returns {Promise<Object>} - The generated API key object
 */
async function generateApiKey(userId, name) {
  try {
    // Generate a random API key
    const apiKey = crypto.randomBytes(24).toString('hex');
    
    // Store the key in the database
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        key: apiKey,
        user_id: userId,
        name,
        created_at: new Date(),
        last_used: null,
        usage_count: 0,
        status: 'active'
      })
      .select()
      .single();
      
    if (error) {
      logger.error('Error creating API key:', error);
      throw new Error('Could not create API key');
    }
    
    logger.info(`API key created for user ${userId}`);
    return { apiKey, data };
  } catch (error) {
    logger.error('Error in generateApiKey:', error);
    throw error;
  }
}

/**
 * Generate a development API key without database validation
 * This should ONLY be used for testing/development
 * @param {string} name - A friendly name for the API key
 * @returns {Object} - The generated API key object
 */
function generateDevApiKey(name = 'Development API Key') {
  // Generate a predictable dev API key or use an environment variable
  const devApiKey = process.env.DEV_API_KEY || 'dev-api-key-universalcircle-123456';
  
  logger.info(`Development API key generated: ${devApiKey.substring(0, 8)}...`);
  
  return { 
    apiKey: devApiKey,
    data: {
      name,
      created_at: new Date(),
      status: 'active',
      is_dev_key: true
    }
  };
}

/**
 * Validate an API key - includes special handling for dev keys
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<boolean>} - Whether the API key is valid
 */
async function validateApiKey(apiKey) {
  try {
    // Special case for development API key
    if (process.env.NODE_ENV !== 'production') {
      const devApiKey = process.env.DEV_API_KEY || 'dev-api-key-universalcircle-123456';
      if (apiKey === devApiKey) {
        logger.info('Development API key used');
        return true;
      }
    }
    
    // Check if the API key exists and is active
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', apiKey)
      .eq('status', 'active')
      .single();
      
    if (error || !data) {
      logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 8)}...`);
      return false;
    }
    
    // Update the last used timestamp and increment usage count
    await trackApiKeyUsage(apiKey);
    
    return true;
  } catch (error) {
    logger.error('Error in validateApiKey:', error);
    return false;
  }
}

/**
 * Track usage of an API key
 * @param {string} apiKey - The API key to track
 */
async function trackApiKeyUsage(apiKey) {
  try {
    // Skip tracking for development API keys to avoid unnecessary database calls
    if (process.env.NODE_ENV !== 'production') {
      const devApiKey = process.env.DEV_API_KEY || 'dev-api-key-universalcircle-123456';
      if (apiKey === devApiKey) {
        logger.debug('Skipping usage tracking for development API key');
        return;
      }
    }

    // Special handling for fallback API keys or testing scenarios
    if (!apiKey || apiKey === 'test-key' || apiKey.includes('fallback')) {
      logger.debug('Skipping usage tracking for special key type');
      return;
    }

    // Check if we can connect to the database before attempting update
    try {
      // A lightweight query to check database connection
      const { error: pingError } = await supabase.from('api_keys').select('count', { count: 'exact', head: true });
      
      if (pingError) {
        logger.warn(`Database connection check failed, skipping API key tracking: ${pingError.message}`);
        return;
      }
    } catch (pingError) {
      logger.warn(`Could not connect to database, skipping API key tracking: ${pingError.message}`);
      return;
    }

    // Update the last used timestamp and increment usage count
    const { error } = await supabase
      .from('api_keys')
      .update({
        last_used: new Date(),
        usage_count: supabase.raw('usage_count + 1')
      })
      .eq('key', apiKey);
      
    if (error) {
      logger.error('Error tracking API key usage:', {
        error: error.message,
        code: error.code,
        hint: error.hint || 'No hint provided',
        details: error.details || 'No details provided'
      });
    }
  } catch (error) {
    // Provide more detailed error logging
    logger.error('Error in trackApiKeyUsage:', {
      message: error.message,
      stack: error.stack,
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'undefined',
      environment: process.env.NODE_ENV || 'unknown'
    });
    
    // Don't throw the error, just log it to prevent API disruption
  }
}

/**
 * Get API key usage statistics
 * @param {string} userId - The user ID to get statistics for
 * @returns {Promise<Array>} - The API key usage statistics
 */
async function getApiKeyStats(userId) {
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', userId);
      
    if (error) {
      logger.error('Error getting API key stats:', error);
      throw new Error('Could not get API key statistics');
    }
    
    return data;
  } catch (error) {
    logger.error('Error in getApiKeyStats:', error);
    throw error;
  }
}

/**
 * Revoke an API key
 * @param {string} apiKey - The API key to revoke
 * @param {string} userId - The user ID associated with the API key
 * @returns {Promise<boolean>} - Whether the API key was revoked
 */
async function revokeApiKey(apiKey, userId) {
  try {
    const { error } = await supabase
      .from('api_keys')
      .update({ status: 'revoked' })
      .eq('key', apiKey)
      .eq('user_id', userId);
      
    if (error) {
      logger.error('Error revoking API key:', error);
      return false;
    }
    
    logger.info(`API key revoked for user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error in revokeApiKey:', error);
    return false;
  }
}

module.exports = {
  generateApiKey,
  validateApiKey,
  trackApiKeyUsage,
  getApiKeyStats,
  revokeApiKey,
  generateDevApiKey
}; 