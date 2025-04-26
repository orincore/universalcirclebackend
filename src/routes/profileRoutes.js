const express = require('express');
const router = express.Router();
const { 
  updateProfile,
  getProfilePictureUploadUrl,
  updateProfilePicture
} = require('../controllers/profileController');
const { authenticate } = require('../middlewares/auth');

// All profile routes require authentication
router.use(authenticate);

// Update user profile
router.put('/', updateProfile);

// Get pre-signed URL for profile picture upload
router.get('/profile-picture-upload-url', getProfilePictureUploadUrl);

// Update profile picture after upload
router.put('/profile-picture', updateProfilePicture);

module.exports = router; 