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
  updateSystemSettings,
  deleteUser,
  sendAdminBroadcast,
  getAdminBroadcasts
} = require('../controllers/adminController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

/**
 * Authentication for Admin Routes
 * 
 * All routes in this file are protected by two middleware functions:
 * 1. authenticate - Verifies the JWT token from the Authorization header
 * 2. isAdmin - Ensures the authenticated user has admin privileges
 * 
 * To use these endpoints, include a standard JWT token in the Authorization header:
 * Authorization: Bearer <token>
 * 
 * The token must belong to a user with admin privileges (is_admin: true in the users table)
 */
router.use(authenticate);
router.use(isAdmin);

// User management routes
router.get('/users', getAllUsers);
router.get('/users/bulk', getAllUsersBulk);
router.get('/users/:userId', getUserById);
router.patch('/users/:userId/admin', updateUserAdminStatus);
router.patch('/users/:userId/ban', updateUserBanStatus);
router.delete('/users/:userId', deleteUser);

// Matchmaking management routes
router.get('/matchmaking/stats', getDetailedMatchmakingStats);

// Content moderation routes
router.delete('/moderation/posts/:postId', deletePost);

// System settings routes
router.get('/settings', getSystemSettings);
router.patch('/settings', updateSystemSettings);

// System health and monitoring routes
router.get('/system/health', getServerHealth);

// Notification broadcast routes
router.post('/notifications/broadcast', sendAdminBroadcast);
router.get('/notifications/broadcasts', getAdminBroadcasts);

module.exports = router; 