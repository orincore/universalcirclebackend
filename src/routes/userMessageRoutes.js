const express = require('express');
const router = express.Router();
const { 
  deleteOwnMessage,
  deleteConversationForUser
} = require('../controllers/userMessageController');
const { reportUserMessages } = require('../controllers/messageModController');
const { authenticate } = require('../middlewares/auth');

// All routes require authentication
router.use(authenticate);

// Report a user with optional message IDs
router.post('/report', reportUserMessages);

// Delete a message (user can only delete their own messages)
router.delete('/:messageId', deleteOwnMessage);

// Delete a conversation from user's perspective
router.delete('/conversations/:otherUserId', deleteConversationForUser);

module.exports = router; 