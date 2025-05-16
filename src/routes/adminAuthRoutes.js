const express = require('express');
const router = express.Router();
const { adminLogin, adminProfile, validateAdminToken } = require('../controllers/adminAuthController');
const { authenticate, isAdmin } = require('../middlewares/auth');

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login
 * @access  Public
 */
router.post('/login', adminLogin);

/**
 * @route   GET /api/admin/auth/profile
 * @desc    Get admin profile
 * @access  Private (Admin only)
 */
router.get('/profile', authenticate, isAdmin, adminProfile);

/**
 * @route   GET /api/admin/auth/validate
 * @desc    Validate admin token
 * @access  Private (Admin only)
 */
router.get('/validate', authenticate, isAdmin, validateAdminToken);

module.exports = router; 