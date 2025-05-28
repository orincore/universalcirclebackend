const express = require('express');
const router = express.Router();
const { 
  sendMessage,
  getConversation,
  getConversations,
  getMessageMediaUploadUrl,
  deleteConversation
} = require('../controllers/messageController');
const { authenticate } = require('../middlewares/auth');

// All message routes require authentication
router.use(authenticate);

// Middleware to ensure user is fully authenticated with valid ID
const ensureValidUser = (req, res, next) => {
  if (!req.user || !req.user.id) {
    console.error('Authentication issue: Missing user ID in request');
    return res.status(401).json({
      success: false,
      message: 'Authentication failed. Please log in again.',
      code: 'AUTH_EXPIRED'
    });
  }
  next();
};

// Send a new message
router.post('/', ensureValidUser, sendMessage);

// Get messages between current user and another user
router.get('/conversation/:userId', ensureValidUser, getConversation);

// Get all conversations for the current user
router.get('/conversations', ensureValidUser, getConversations);

// Get pre-signed URL for message media upload
router.post('/media-upload-url', ensureValidUser, getMessageMediaUploadUrl);

// Delete conversation with another user
router.delete('/conversation/:userId', ensureValidUser, deleteConversation);

module.exports = router; 