const express = require('express');
const router = express.Router();
const { 
  getAppStats,
  getUserStats
} = require('../controllers/analyticsController');
const { authenticate } = require('../middlewares/auth');

// All analytics routes require authentication
router.use(authenticate);

// Get app statistics (admin only)
router.get('/app', async (req, res, next) => {
  // Check if user is admin (hardcoded for now, could be a property in user table)
  if (req.user.email !== 'admin@example.com') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
}, getAppStats);

// Get user statistics
router.get('/user', getUserStats);

module.exports = router; 