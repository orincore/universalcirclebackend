const supabase = require('../config/database');
const logger = require('../utils/logger');

/**
 * Middleware to check if the authenticated user is an admin
 * This middleware should be used after the authenticate middleware
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const isAdmin = async (req, res, next) => {
  try {
    // User is already set by the authenticate middleware
    // Support different token formats and improve logging
    const userId = req.user?.id || req.user?.userId;
    
    if (!userId) {
      logger.warn('Admin check failed: No user ID found in JWT token');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - Invalid token format'
      });
    }
    
    // Log the token payload for debugging
    logger.info(`Admin check for user ID: ${userId}, token role: ${req.user?.role}`);
    
    // Check if user has admin role directly from the JWT token
    if (req.user.role === 'admin') {
      logger.info(`User ${userId} authorized as admin via JWT role claim`);
      return next();
    }
    
    // If role not in token, verify from database
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
      
    if (error) {
      logger.warn(`Database error during admin check for user ${userId}: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error verifying admin status'
      });
    }
    
    if (!data) {
      logger.warn(`User ${userId} not found in database during admin check`);
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
    logger.info(`User ${userId} authorized as admin via database lookup`);
    next();
  } catch (error) {
    logger.error('Error in admin authorization:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during admin authorization'
    });
  }
};

module.exports = {
  isAdmin
}; 