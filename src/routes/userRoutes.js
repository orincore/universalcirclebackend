const express = require('express');
const router = express.Router();
const { 
  searchUsers,
  getUserProfile,
  getUserDetails,
  updateUserDetails,
  banOrSuspendUser
} = require('../controllers/userController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All user routes require authentication
router.use(authenticate);

// Search for users
router.get('/search', searchUsers);

// Get comprehensive user details
router.get('/details/:userId', getUserDetails);

// Update user details (self or admin only)
router.put('/:userId', updateUserDetails);
router.patch('/:userId', updateUserDetails);

// Admin-only routes for user management
router.post('/:userId/status', isAdmin, banOrSuspendUser);

// Get user profile by ID (basic info)
router.get('/:userId', getUserProfile);

module.exports = router; 