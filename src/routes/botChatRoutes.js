const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { sendMessageToBot, getBotConversation } = require('../controllers/botChatController');

// Direct bot messaging endpoints
router.post('/send', authenticate, sendMessageToBot);
router.get('/conversation/:botId', authenticate, getBotConversation);

module.exports = router; 