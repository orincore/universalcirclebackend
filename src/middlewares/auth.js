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
      logger.warn(`Authentication failed: Missing or invalid authorization header`);
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid token.'
      });
    }
    
    // Extract the token
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      logger.warn(`Authentication failed: Token missing in authorization header`);
      return res.status(401).json({
        success: false,
        message: 'Authentication token is missing'
      });
    }
    
    // Verify the token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Log token validation success
      logger.info(`Token verified for user: ${decoded.id || decoded.userId || 'unknown'}`);
      
      // Set the user on the request object
      req.user = decoded;
      
      // Continue to the next middleware
      next();
    } catch (jwtError) {
      // Specific JWT errors
      if (jwtError.name === 'TokenExpiredError') {
        logger.warn('Token expired:', jwtError);
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please log in again.'
        });
      }
      
      if (jwtError.name === 'JsonWebTokenError') {
        logger.warn('Invalid token:', jwtError);
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please log in again.'
        });
      }
      
      // Re-throw to be caught by the outer catch
      throw jwtError;
    }
  } catch (error) {
    logger.error('Authentication error:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

module.exports = {
  authenticate
}; 