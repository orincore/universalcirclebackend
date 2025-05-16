const express = require('express');
const router = express.Router();
const { 
  getTotalUsers,
  getUserActivity,
  getDailyActiveUsers,
  getMatchesCreated,
  getMessagesSent,
  getMatchSuccessRate,
  getRecentActivity,
  getReportTypesSummary
} = require('../controllers/adminAnalyticsController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All admin analytics routes require authentication and admin privileges
router.use(authenticate);
router.use(isAdmin);

// User statistics routes
router.get('/users/total', getTotalUsers);
router.get('/users/activity', getUserActivity);
router.get('/users/daily-active', getDailyActiveUsers);

// Matching statistics routes
router.get('/matches/created', getMatchesCreated);
router.get('/matches/success-rate', getMatchSuccessRate);

// Message statistics routes
router.get('/messages/sent', getMessagesSent);

// Activity and reporting routes
router.get('/activity/recent', getRecentActivity);
router.get('/reports/summary', getReportTypesSummary);

module.exports = router; 