const express = require('express');
const router = express.Router();
const { 
  searchUsers,
  getUserProfile
} = require('../controllers/userController');
const { authenticate } = require('../middlewares/auth');

// All user routes require authentication
router.use(authenticate);

// Search for users
router.get('/search', searchUsers);

// Get user profile by ID
router.get('/:userId', getUserProfile);

module.exports = router; 