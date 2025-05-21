const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { 
  requestVerification, 
  submitVerification,
  checkVerificationStatus,
  getVerifiedStatus
} = require('../controllers/verificationController');

// User verification routes
router.post('/request', authenticate, requestVerification);
router.post('/submit', authenticate, submitVerification);
router.get('/status', authenticate, checkVerificationStatus);
router.get('/', authenticate, getVerifiedStatus);

module.exports = router; 