const express = require('express');
const router = express.Router();
const adminReportController = require('../controllers/adminReportController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All admin report routes require authentication and admin privileges
router.use(authenticate);
router.use(isAdmin);

// Get all reports with filtering and pagination
router.get('/', adminReportController.getAllReports);

// Get report details
router.get('/:reportId', adminReportController.getReportDetails);

// Update report status
router.patch('/:reportId', adminReportController.updateReportStatus);

module.exports = router; 