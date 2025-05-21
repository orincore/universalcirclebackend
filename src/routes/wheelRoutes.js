const express = require('express');
const router = express.Router();
const wheelController = require('../controllers/wheelController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// Public routes - None for wheel, all require authentication

// User routes - authenticated users
router.get('/availability', authenticate, wheelController.checkAvailability);
router.post('/spin', authenticate, wheelController.spinWheel);
router.get('/rewards', authenticate, wheelController.getMyRewards);
router.post('/rewards/:rewardId/claim', authenticate, wheelController.claimReward);
router.get('/options', authenticate, wheelController.getWheelRewards);

// Admin routes
router.post('/admin/cleanup', authenticate, isAdmin, wheelController.cleanupExpiredRewards);

module.exports = router; 