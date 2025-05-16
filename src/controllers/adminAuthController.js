const supabase = require('../config/database');
const { comparePassword } = require('../utils/password');
const { generateToken } = require('../utils/jwt');
const { adminLoginSchema } = require('../models/admin');
const logger = require('../utils/logger');

/**
 * Admin login 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const adminLogin = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = adminLoginSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { emailOrUsername, password } = value;

    // Find user by email or username and ensure they are an admin
    const { data: admin, error: findError } = await supabase
      .from('users')
      .select('*')
      .or(`email.eq.${emailOrUsername},username.eq.${emailOrUsername}`)
      .eq('is_admin', true)
      .single();

    if (findError || !admin) {
      logger.warn(`Failed admin login attempt for: ${emailOrUsername}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Compare passwords
    const isPasswordValid = await comparePassword(password, admin.password);

    if (!isPasswordValid) {
      logger.warn(`Failed admin login (invalid password) for: ${emailOrUsername}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Remove password from response
    delete admin.password;

    // Generate JWT token with admin flag
    const token = generateToken({
      ...admin,
      isAdmin: true  // Add admin flag to token payload
    });

    // Update last login timestamp
    await supabase
      .from('users')
      .update({ 
        last_login: new Date(),
        admin_login_count: (admin.admin_login_count || 0) + 1
      })
      .eq('id', admin.id);

    logger.info(`Admin login successful: ${admin.username} (${admin.id})`);
    
    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: {
        admin,
        token
      }
    });
  } catch (error) {
    logger.error('Admin login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during admin login'
    });
  }
};

/**
 * Get current authenticated admin profile
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const adminProfile = async (req, res) => {
  try {
    // User is already attached to req by auth middleware and admin status checked
    return res.status(200).json({
      success: true,
      data: {
        admin: req.user
      }
    });
  } catch (error) {
    logger.error('Get admin profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching admin profile'
    });
  }
};

/**
 * Check if token is valid and has admin privileges
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const validateAdminToken = async (req, res) => {
  // If we reached here, it means the token is valid and the user is an admin
  // (due to authenticate and isAdmin middleware)
  return res.status(200).json({
    success: true,
    message: 'Valid admin token',
    data: {
      isValidAdmin: true
    }
  });
};

module.exports = {
  adminLogin,
  adminProfile,
  validateAdminToken
}; 