const { validateApiKey } = require('../services/apiKeyService');
const logger = require('../utils/logger');

/**
 * Middleware to validate API key
 * Extracts API key from request header 'x-api-key' or query parameter 'api_key'
 */
const apiKeyAuth = async (req, res, next) => {
  try {
    // Get API key from header or query
    const apiKey = req.header('x-api-key') || req.query.api_key;
    
    // If no API key is provided, return error
    if (!apiKey) {
      logger.warn('API request without API key');
      return res.status(401).json({
        success: false,
        message: 'API key is required'
      });
    }
    
    // Validate API key
    const isValid = await validateApiKey(apiKey);
    
    if (!isValid) {
      logger.warn(`Invalid API key: ${apiKey.substring(0, 8)}...`);
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }
    
    // Store API key in request for further use
    req.apiKey = apiKey;
    
    // Continue to next middleware
    next();
  } catch (error) {
    logger.error('Error in API key authentication:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

module.exports = apiKeyAuth; 