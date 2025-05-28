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
    
    // Set the user on the request object
    req.user = decoded;
    
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