const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All report routes require authentication
router.use(authenticate);

// Submit a new report
router.post('/', reportController.submitReport);

// Get current user's reports
router.get('/my-reports', reportController.getUserReports);

// Get user report analytics (admin or self only)
router.get('/analytics/user/:userId', reportController.getUserReportAnalytics);

module.exports = router; 