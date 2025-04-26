const express = require('express');
const router = express.Router();
const { 
  sendMessage,
  getConversation,
  getConversations,
  getMessageMediaUploadUrl
} = require('../controllers/messageController');
const { authenticate } = require('../middlewares/auth');

// All message routes require authentication
router.use(authenticate);

// Send a new message
router.post('/', sendMessage);

// Get messages between current user and another user
router.get('/conversation/:userId', getConversation);

// Get all conversations for the current user
router.get('/conversations', getConversations);

// Get pre-signed URL for message media upload
router.post('/media-upload-url', getMessageMediaUploadUrl);

module.exports = router; 