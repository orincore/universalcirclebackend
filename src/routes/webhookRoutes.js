const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Use the webhook controller routes
router.use('/', webhookController);

module.exports = router; 