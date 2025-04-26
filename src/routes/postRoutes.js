const express = require('express');
const router = express.Router();
const { 
  createPost,
  getFeed,
  getUserPosts,
  getPost,
  getPostMediaUploadUrl,
  addComment,
  getComments,
  reactToPost
} = require('../controllers/postController');
const { authenticate } = require('../middlewares/auth');

// All post routes require authentication
router.use(authenticate);

// Feed routes
router.get('/feed', getFeed);

// Post creation routes
router.post('/', createPost);
router.post('/media-upload-url', getPostMediaUploadUrl);

// Post viewing routes
router.get('/user/:userId', getUserPosts);
router.get('/:postId', getPost);

// Comment routes
router.post('/:postId/comments', addComment);
router.get('/:postId/comments', getComments);

// Reaction routes
router.post('/:postId/react', reactToPost);

module.exports = router; 