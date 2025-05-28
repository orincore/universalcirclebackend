const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { 
  requestVerification, 
  submitVerification,
  checkVerificationStatus,
  getVerifiedStatus,
  getVideoUploadUrl,
  submitVerificationVideo,
  getVerificationStatus,
  deleteVerificationRequest
} = require('../controllers/verificationController');

// User verification routes
router.post('/request', authenticate, requestVerification);
router.post('/submit', authenticate, submitVerification);
router.get('/status', authenticate, checkVerificationStatus);
router.get('/', authenticate, getVerifiedStatus);

// All verification routes require authentication
router.use(authenticate);

// Get pre-signed URL for video upload
router.get('/video-upload-url', getVideoUploadUrl);

// Submit verification video
router.post('/video', submitVerificationVideo);

// Get verification status
router.get('/status', getVerificationStatus);

// Delete pending verification request
router.delete('/video', deleteVerificationRequest);

module.exports = router; 