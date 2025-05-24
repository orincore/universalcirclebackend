const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const {
  generateApiKey,
  getApiKeyStats,
  revokeApiKey
} = require('../services/apiKeyService');
const supabase = require('../config/database');
const logger = require('../utils/logger');

// Admin middleware to check if the authenticated user is an admin
const isAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Get user details from database
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
      
    if (error || !data) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not found'
      });
    }
    
    // Check if user is an admin
    if (data.role !== 'admin') {
      logger.warn(`Non-admin user ${userId} attempted to access admin route`);
      return res.status(403).json({
        success: false,
        message: 'Forbidden - Admin access required'
      });
    }
    
    // User is an admin, proceed
    next();
  } catch (error) {
    logger.error('Error in admin authorization:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during admin authorization'
    });
  }
};

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(isAdmin);

/**
 * Get all API keys in the system with optional filtering
 * @route GET /api/admin/keys
 */
router.get('/', async (req, res) => {
  try {
    // Extract query parameters for filtering
    const { user_id, status, limit = 100, offset = 0 } = req.query;
    
    // Build query
    let query = supabase
      .from('api_keys')
      .select(`
        id,
        key,
        user_id,
        name,
        created_at,
        last_used,
        usage_count,
        status,
        rate_limit,
        users:user_id (id, first_name, last_name, username, email)
      `)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    
    // Apply filters if provided
    if (user_id) {
      query = query.eq('user_id', user_id);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error, count } = await query;
    
    if (error) {
      logger.error('Error fetching API keys:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching API keys'
      });
    }
    
    // Sanitize the API keys for security
    const sanitizedKeys = data.map(key => ({
      id: key.id,
      user: key.users,
      name: key.name,
      created_at: key.created_at,
      last_used: key.last_used,
      usage_count: key.usage_count,
      status: key.status,
      rate_limit: key.rate_limit,
      key_preview: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 4)}`
    }));
    
    return res.json({
      success: true,
      data: sanitizedKeys,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
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
 * Generate a new API key for a specific user
 * @route POST /api/admin/keys
 */
router.post('/', async (req, res) => {
  try {
    const { user_id, name, rate_limit, permissions } = req.body;
    
    if (!user_id || !name) {
      return res.status(400).json({
        success: false,
        message: 'User ID and API key name are required'
      });
    }
    
    // Verify the user exists
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, username')
      .eq('id', user_id)
      .single();
      
    if (userError || !userData) {
      logger.error('Error verifying user exists:', userError);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Generate the API key
    const result = await generateApiKey(user_id, name);
    
    // If rate limit was specified, update it
    if (rate_limit) {
      const { error: updateError } = await supabase
        .from('api_keys')
        .update({ rate_limit })
        .eq('key', result.apiKey);
        
      if (updateError) {
        logger.error('Error updating rate limit for new API key:', updateError);
      }
    }
    
    // If permissions were specified, update them
    if (permissions) {
      const { error: permissionsError } = await supabase
        .from('api_keys')
        .update({ permissions: JSON.stringify(permissions) })
        .eq('key', result.apiKey);
        
      if (permissionsError) {
        logger.error('Error updating permissions for new API key:', permissionsError);
      }
    }
    
    logger.info(`Admin generated API key for user ${user_id}`);
    
    return res.status(201).json({
      success: true,
      message: 'API key generated successfully',
      data: {
        apiKey: result.apiKey,
        user: {
          id: userData.id,
          first_name: userData.first_name,
          last_name: userData.last_name,
          username: userData.username
        },
        name: name,
        created_at: result.data.created_at,
        rate_limit: rate_limit || 100
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
 * Get a specific API key's details
 * @route GET /api/admin/keys/:key
 */
router.get('/:key', async (req, res) => {
  try {
    const apiKey = req.params.key;
    
    const { data, error } = await supabase
      .from('api_keys')
      .select(`
        id,
        key,
        user_id,
        name,
        created_at,
        last_used,
        usage_count,
        status,
        rate_limit,
        permissions,
        users:user_id (id, first_name, last_name, username, email)
      `)
      .eq('key', apiKey)
      .single();
      
    if (error || !data) {
      logger.warn(`API key not found: ${apiKey.substring(0, 8)}...`);
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }
    
    // Sanitize the API key for security
    const sanitizedKey = {
      id: data.id,
      user: data.users,
      name: data.name,
      created_at: data.created_at,
      last_used: data.last_used,
      usage_count: data.usage_count,
      status: data.status,
      rate_limit: data.rate_limit,
      permissions: data.permissions,
      key_preview: `${data.key.substring(0, 8)}...${data.key.substring(data.key.length - 4)}`
    };
    
    return res.json({
      success: true,
      data: sanitizedKey
    });
  } catch (error) {
    logger.error('Error fetching API key details:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching API key details'
    });
  }
});

/**
 * Revoke an API key
 * @route DELETE /api/admin/keys/:key
 */
router.delete('/:key', async (req, res) => {
  try {
    const apiKey = req.params.key;
    
    // First check if the key exists
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, user_id')
      .eq('key', apiKey)
      .single();
      
    if (error || !data) {
      logger.warn(`API key not found for revocation: ${apiKey.substring(0, 8)}...`);
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }
    
    // Update key status to revoked
    const { error: updateError } = await supabase
      .from('api_keys')
      .update({ status: 'revoked' })
      .eq('key', apiKey);
      
    if (updateError) {
      logger.error('Error revoking API key:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Error revoking API key'
      });
    }
    
    logger.info(`Admin revoked API key for user ${data.user_id}`);
    
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

/**
 * Get usage statistics for all API keys
 * @route GET /api/admin/keys/stats/summary
 */
router.get('/stats/summary', async (req, res) => {
  try {
    // Get total count of API keys
    const { count: totalCount, error: countError } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true });
      
    if (countError) {
      logger.error('Error counting API keys:', countError);
      return res.status(500).json({
        success: false,
        message: 'Error counting API keys'
      });
    }
    
    // Get count of active keys
    const { count: activeCount, error: activeError } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
      
    if (activeError) {
      logger.error('Error counting active API keys:', activeError);
      return res.status(500).json({
        success: false,
        message: 'Error counting active API keys'
      });
    }
    
    // Get count of revoked keys
    const { count: revokedCount, error: revokedError } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'revoked');
      
    if (revokedError) {
      logger.error('Error counting revoked API keys:', revokedError);
      return res.status(500).json({
        success: false,
        message: 'Error counting revoked API keys'
      });
    }
    
    // Get top 5 most used API keys
    const { data: topUsedKeys, error: topUsedError } = await supabase
      .from('api_keys')
      .select(`
        id,
        key,
        user_id,
        name,
        usage_count,
        users:user_id (id, first_name, last_name, username)
      `)
      .order('usage_count', { ascending: false })
      .limit(5);
      
    if (topUsedError) {
      logger.error('Error fetching top used API keys:', topUsedError);
      return res.status(500).json({
        success: false,
        message: 'Error fetching top used API keys'
      });
    }
    
    // Sanitize the top used keys
    const sanitizedTopUsed = topUsedKeys.map(key => ({
      id: key.id,
      user: key.users,
      name: key.name,
      usage_count: key.usage_count,
      key_preview: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 4)}`
    }));
    
    return res.json({
      success: true,
      data: {
        total_keys: totalCount,
        active_keys: activeCount,
        revoked_keys: revokedCount,
        top_used_keys: sanitizedTopUsed
      }
    });
  } catch (error) {
    logger.error('Error fetching API key statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching API key statistics'
    });
  }
});

module.exports = router; 