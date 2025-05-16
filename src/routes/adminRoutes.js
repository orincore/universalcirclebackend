const express = require('express');
const router = express.Router();
const { 
  getAllUsers,
  getAllUsersBulk,
  getUserById,
  updateUserAdminStatus,
  updateUserBanStatus,
  getDetailedMatchmakingStats,
  getServerHealth,
  deletePost,
  getSystemSettings,
  updateSystemSettings
} = require('../controllers/adminController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All admin routes require authentication and admin privileges
router.use(authenticate);
router.use(isAdmin);

// User management routes
router.get('/users', getAllUsers);
router.get('/users/bulk', getAllUsersBulk);
router.get('/users/:userId', getUserById);
router.patch('/users/:userId/admin', updateUserAdminStatus);
router.patch('/users/:userId/ban', updateUserBanStatus);

// Matchmaking management routes
router.get('/matchmaking/stats', getDetailedMatchmakingStats);

// Content moderation routes
router.delete('/moderation/posts/:postId', deletePost);

// System settings routes
router.get('/settings', getSystemSettings);
router.patch('/settings', updateSystemSettings);

// System health and monitoring routes
router.get('/system/health', getServerHealth);

module.exports = router; 