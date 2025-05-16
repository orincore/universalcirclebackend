/**
 * Middleware to check if a user has admin privileges
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const isAdmin = (req, res, next) => {
  try {
    // Check if user exists and has admin privileges
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    
    // If admin, proceed to next middleware/controller
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during admin authorization'
    });
  }
};

module.exports = {
  isAdmin
}; 