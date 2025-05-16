const express = require('express');
const router = express.Router();
const adminReportController = require('../controllers/adminReportController');

// Get all reports with filtering and pagination
router.get('/', adminReportController.getAllReports);

// Get report details
router.get('/:reportId', adminReportController.getReportDetails);

// Update report status
router.patch('/:reportId', adminReportController.updateReportStatus);

module.exports = router; 