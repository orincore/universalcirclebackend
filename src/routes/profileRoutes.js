const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const multer = require('multer');
const { 
  getUserProfile, 
  updateProfile, 
  uploadVoiceBio, 
  deleteVoiceBio, 
  getVoiceBio,
  getProfilePictureUploadUrl,
  updateProfilePicture
} = require('../controllers/profileController');

// Setup multer for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Profile routes
router.get('/', authenticate, getUserProfile);
router.put('/', authenticate, updateProfile);

// Voice bio routes
router.post('/voice-bio', authenticate, upload.single('audio'), uploadVoiceBio);
router.delete('/voice-bio', authenticate, deleteVoiceBio);
router.get('/voice-bio/:userId', getVoiceBio);

// Get pre-signed URL for profile picture upload
router.get('/profile-picture-upload-url', authenticate, getProfilePictureUploadUrl);

// Update profile picture after upload
router.put('/profile-picture', authenticate, updateProfilePicture);

module.exports = router; 