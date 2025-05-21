const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const {
  getAllAchievements,
  getAchievementsByCategory,
  getCurrentUserAchievements,
  getCurrentUserCompletedAchievements,
  getUserAchievements,
  getCurrentUserProgress,
  checkProfileCompletion,
  manuallyCheckAchievement
} = require('../controllers/achievementController');

// Public routes - anyone can view available achievements
router.get('/', getAllAchievements);
router.get('/category/:category', getAchievementsByCategory);

// Authenticated user routes
router.get('/my', authenticate, getCurrentUserAchievements);
router.get('/my/completed', authenticate, getCurrentUserCompletedAchievements);
router.get('/my/progress', authenticate, getCurrentUserProgress);
router.post('/my/check-profile', authenticate, checkProfileCompletion);

// View other user's achievements (public profiles)
router.get('/user/:userId', getUserAchievements);

// Admin routes
const adminAuth = [authenticate, isAdmin];
router.post('/admin/check', adminAuth, manuallyCheckAchievement);

module.exports = router; 