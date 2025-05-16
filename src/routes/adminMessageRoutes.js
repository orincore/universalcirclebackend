const express = require('express');
const router = express.Router();
const { 
  getReportedMessages,
  deleteMessage,
  deleteConversation
} = require('../controllers/messageModController');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(isAdmin);

// Get reported messages for a specific report
router.get('/reports/:reportId/messages', getReportedMessages);

// Delete a specific message
router.delete('/messages/:messageId', deleteMessage);

// Delete a conversation between two users
router.delete('/conversations/:user1Id/:user2Id', deleteConversation);

module.exports = router; 