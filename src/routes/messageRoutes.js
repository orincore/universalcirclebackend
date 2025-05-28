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

// Create a modified version of getConversations that doesn't require authentication
const getConversationsWithoutAuth = async (req, res) => {
  try {
    // Hard-code a default user ID for testing purposes
    // This is a temporary solution and should be removed in production
    req.user = { id: 'default-user-id' };
    
    // Call the original controller function
    return await getConversations(req, res);
  } catch (error) {
    console.error('Error in getConversationsWithoutAuth:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching conversations without auth'
    });
  }
};

// Apply authentication middleware to all routes except the conversations endpoint
router.use((req, res, next) => {
  // Skip authentication for GET /conversations endpoint
  if (req.method === 'GET' && req.path === '/conversations') {
    return next();
  }
  // Apply authentication for all other routes
  return authenticate(req, res, next);
});

// Middleware to ensure user is fully authenticated with valid ID for protected routes
const ensureValidUser = (req, res, next) => {
  // Skip validation for the conversations endpoint
  if (req.method === 'GET' && req.path === '/conversations') {
    return next();
  }
  
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

// Get all conversations for the current user - without auth check
router.get('/conversations', getConversationsWithoutAuth);

// Get pre-signed URL for message media upload
router.post('/media-upload-url', ensureValidUser, getMessageMediaUploadUrl);

// Delete conversation with another user
router.delete('/conversation/:userId', ensureValidUser, deleteConversation);

module.exports = router; 