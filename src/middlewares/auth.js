const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Middleware to authenticate requests using JWT
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const authenticate = async (req, res, next) => {
  try {
    // Check if user ID is provided in headers (for mobile apps)
    const headerUserId = req.headers['x-user-id'] || req.headers['user-id'];
    if (headerUserId) {
      logger.info(`User ID provided in headers: ${headerUserId}`);
      
      // Set user object with ID from header
      req.user = {
        id: headerUserId,
        source: 'header'
      };
      
      // Continue if this is all we need
      if (process.env.ALLOW_HEADER_AUTH === 'true') {
        return next();
      }
    }
    
    // Get the authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid token.'
      });
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is missing'
      });
    }
    
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Ensure user ID is present in the decoded token
    if (!decoded.id && !decoded.userId) {
      logger.warn('Token missing user ID', { decoded });
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token. Missing user ID.',
        code: 'AUTH_INVALID'
      });
    }
    
    // Set the user on the request object, ensuring id is always set
    req.user = {
      ...decoded,
      id: decoded.id || decoded.userId
    };
    
    // If we already have a header userId and it doesn't match the token, log it
    if (headerUserId && headerUserId !== req.user.id) {
      logger.warn(`User ID mismatch: header=${headerUserId}, token=${req.user.id}`);
    }
    
    // Continue to the next middleware
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please log in again.',
        code: 'AUTH_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Please log in again.',
        code: 'AUTH_INVALID'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

module.exports = {
  authenticate
}; 