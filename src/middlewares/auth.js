const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');

/**
 * Middleware to authenticate requests using JWT
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Check if user exists in database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or unauthorized'
      });
    }

    // Remove password from user object
    delete user.password;
    
    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

/**
 * Middleware to check if a user has admin privileges
 */
const isAdmin = async (req, res, next) => {
  try {
    // First ensure we have a user from the authenticate middleware
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Check if user has admin role in database
    const { data, error } = await supabase
      .from('users')
      .select('is_admin, role')
      .eq('id', req.user.id)
      .single();
    
    if (error || !data) {
      console.error('Error checking admin status:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking admin privileges'
      });
    }
    
    // Check if user has admin permissions
    const isAdmin = data.is_admin === true || data.role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized. Admin privileges required.'
      });
    }
    
    // Add admin flag to user object
    req.user.isAdmin = true;
    
    next();
  } catch (error) {
    console.error('Admin authorization error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking admin privileges'
    });
  }
};

module.exports = {
  authenticate,
  isAdmin
}; 