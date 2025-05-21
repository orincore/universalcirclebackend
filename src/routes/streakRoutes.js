const express = require('express');
const router = express.Router();
const streakController = require('../controllers/streakController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// Public routes - None for streaks since all require authentication

// User routes - authenticated users can access their own streak data
router.get('/my/active', authenticate, streakController.getMyActiveStreaks);
router.get('/my/milestones', authenticate, streakController.getMyMilestones);
router.get('/with/:userId', authenticate, streakController.getStreakWithUser);
router.get('/conversation/:conversationId', authenticate, streakController.getConversationStreak);
router.get('/bonuses', authenticate, streakController.getStreakBonuses);

// Admin routes
router.get('/admin/expiring', authenticate, isAdmin, streakController.getExpiringStreaks);

module.exports = router; 