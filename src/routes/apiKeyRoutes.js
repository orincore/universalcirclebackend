const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const {
  generateApiKey,
  getApiKeyStats,
  revokeApiKey
} = require('../services/apiKeyService');
const logger = require('../utils/logger');

/**
 * Route to generate a new API key
 * @route POST /api/keys
 * @requires Authentication
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'API key name is required'
      });
    }
    
    const result = await generateApiKey(userId, name);
    
    // Return only the API key in the response, not the database record
    return res.status(201).json({
      success: true,
      message: 'API key generated successfully',
      data: {
        apiKey: result.apiKey,
        name: name,
        created_at: result.data.created_at
      }
    });
  } catch (error) {
    logger.error('Error generating API key:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating API key'
    });
  }
});

/**
 * Route to get all API keys for a user
 * @route GET /api/keys
 * @requires Authentication
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const apiKeys = await getApiKeyStats(userId);
    
    // Don't return the actual API keys in the response for security
    const sanitizedKeys = apiKeys.map(key => ({
      id: key.id,
      name: key.name,
      created_at: key.created_at,
      last_used: key.last_used,
      usage_count: key.usage_count,
      status: key.status,
      key_preview: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 4)}`
    }));
    
    return res.json({
      success: true,
      data: sanitizedKeys
    });
  } catch (error) {
    logger.error('Error fetching API keys:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching API keys'
    });
  }
});

/**
 * Route to revoke an API key
 * @route DELETE /api/keys/:id
 * @requires Authentication
 */
router.delete('/:key', authenticate, async (req, res) => {
  try {
    const apiKey = req.params.key;
    const userId = req.user.id;
    
    const success = await revokeApiKey(apiKey, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'API key not found or already revoked'
      });
    }
    
    return res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    logger.error('Error revoking API key:', error);
    return res.status(500).json({
      success: false,
      message: 'Error revoking API key'
    });
  }
});

module.exports = router; 