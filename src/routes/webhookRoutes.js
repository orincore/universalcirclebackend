const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Process a new report with AI
router.post('/report-processing', webhookController.processNewReport);

module.exports = router; 