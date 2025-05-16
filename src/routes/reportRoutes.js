const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middleware/authMiddleware');

// All report routes require authentication
router.use(authenticate);

// Submit a new report
router.post('/', reportController.submitReport);

// Get current user's reports
router.get('/my-reports', reportController.getUserReports);

module.exports = router; 