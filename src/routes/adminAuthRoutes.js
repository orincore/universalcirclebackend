const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const supabase = require('../config/database');
const logger = require('../utils/logger');
const adminAuthController = require('../controllers/adminAuthController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find admin user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('role', 'admin')
      .single();
      
    if (error || !user) {
      logger.warn(`Failed admin login attempt for email: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      logger.warn(`Invalid password for admin login: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    logger.info(`Admin user logged in: ${user.email}`);
    
    // Return token and user info (excluding password)
    const { password: _, ...userWithoutPassword } = user;
    
    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    logger.error('Admin login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

/**
 * @route   GET /api/admin/auth/profile
 * @desc    Get admin profile
 * @access  Private (Admin only)
 */
router.get('/profile', authenticate, isAdmin, adminAuthController.adminProfile);

/**
 * @route   GET /api/admin/auth/validate
 * @desc    Validate admin token
 * @access  Private (Admin only)
 */
router.get('/validate', authenticate, isAdmin, adminAuthController.validateAdminToken);

/**
 * Verify token validity
 * @route POST /api/admin/auth/verify
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and is an admin
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, role, first_name, last_name')
      .eq('id', decoded.id)
      .eq('role', 'admin')
      .single();
      
    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user no longer exists'
      });
    }
    
    return res.json({
      success: true,
      message: 'Token is valid',
      user
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    logger.error('Token verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during token verification'
    });
  }
});

module.exports = router; 