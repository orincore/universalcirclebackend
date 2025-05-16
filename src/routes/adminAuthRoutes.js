const express = require('express');
const router = express.Router();
const adminAuthController = require('../controllers/adminAuthController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login
 * @access  Public
 */
router.post('/login', adminAuthController.adminLogin);

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

module.exports = router; 