const supabase = require('../config/database');
const { error, info } = require('../utils/logger');
const { getUserById, updateUserProfile } = require('../services/userService');
const { uploadFile, deleteFile, generateSignedUrl } = require('../services/fileService');
const { profileUpdateSchema } = require('../models/user');
const { generateUploadUrl } = require('../utils/awsS3');
const { validateInterests } = require('../utils/interests');
const achievementService = require('../services/achievementService');

/**
 * Get user profile
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove sensitive information
    delete user.password;
    delete user.reset_token;
    
    // Generate signed URL for voice bio if it exists
    if (user.voice_bio_url) {
      user.voice_bio_url = await generateSignedUrl(user.voice_bio_url);
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: user
      }
    });
  } catch (err) {
    error(`Error in getUserProfile: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user profile'
    });
  }
};

/**
 * Update user profile
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      first_name,
      last_name,
      bio,
      location,
      birth_date,
      preferences,
      private_profile,
      interests,
      gender,
      profile_picture_url,
      phone,
      username
    } = req.body;

    // Build update object with only provided fields
    const updates = {};
    
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (bio !== undefined) updates.bio = bio;
    if (location !== undefined) updates.location = location;
    if (birth_date !== undefined) updates.birth_date = birth_date;
    if (preferences !== undefined) updates.preferences = preferences;
    if (private_profile !== undefined) updates.private_profile = private_profile;
    if (interests !== undefined) updates.interests = interests;
    if (gender !== undefined) updates.gender = gender;
    if (profile_picture_url !== undefined) updates.profile_picture_url = profile_picture_url;
    if (phone !== undefined) updates.phone = phone;
    if (username !== undefined) updates.username = username;
    
    console.log(`Updating profile for user ${userId} with fields:`, Object.keys(updates));
    if (interests) console.log(`Interests to update:`, interests);

    // Validate required fields are not empty
    if ('first_name' in updates && !updates.first_name) {
      return res.status(400).json({
        success: false,
        message: 'First name cannot be empty'
      });
    }
    
    if ('last_name' in updates && !updates.last_name) {
      return res.status(400).json({
        success: false,
        message: 'Last name cannot be empty'
      });
    }

    // Update profile
    const result = await updateUserProfile(userId, updates);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check for profile completion achievement
    const completedAchievements = await achievementService.checkProfileCompletion(userId);

    // Get updated user data to return in response
    const updatedUser = await getUserById(userId);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name,
          bio: updatedUser.bio,
          interests: updatedUser.interests,
          profile_picture_url: updatedUser.profile_picture_url
        },
        achievementsCompleted: completedAchievements
      }
    });
  } catch (err) {
    error(`Error in updateProfile: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
};

/**
 * Upload voice bio
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const uploadVoiceBio = async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided'
      });
    }
    
    // Check file type
    const validMimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm'];
    if (!validMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Please upload MP3, WAV, or WebM audio.'
      });
    }
    
    // Check file size (max 5MB)
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (req.file.size > MAX_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.'
      });
    }
    
    // Get user to check if they already have a voice bio
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // If user already has a voice bio, delete the old one
    if (user.voice_bio_url) {
      await deleteFile(user.voice_bio_url);
    }
    
    // Generate unique filepath
    const extension = req.file.originalname.split('.').pop();
    const filepath = `voice-bios/${userId}-${Date.now()}.${extension}`;
    
    // Upload new file
    const uploadResult = await uploadFile(req.file.buffer, filepath, req.file.mimetype);
    
    if (!uploadResult.success) {
      throw new Error('Failed to upload voice bio');
    }
    
    // Update user profile with new voice bio URL
    await updateUserProfile(userId, { 
      voice_bio_url: filepath,
      voice_bio_updated_at: new Date()
    });
    
    info(`User ${userId} uploaded new voice bio`);

    // Check for voice bio achievement
    const completedAchievements = await achievementService.checkVoiceBioAchievement(userId);
    
    return res.status(200).json({
      success: true,
      message: 'Voice bio uploaded successfully',
      data: {
        url: await generateSignedUrl(filepath),
        achievementsCompleted: completedAchievements
      }
    });
  } catch (err) {
    error(`Error in uploadVoiceBio: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error uploading voice bio'
    });
  }
};

/**
 * Delete voice bio
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteVoiceBio = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user to check if they have a voice bio
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.voice_bio_url) {
      return res.status(400).json({
        success: false,
        message: 'No voice bio found'
      });
    }
    
    // Delete file from storage
    await deleteFile(user.voice_bio_url);
    
    // Update user profile
    await updateUserProfile(userId, { 
      voice_bio_url: null,
      voice_bio_updated_at: null
    });
    
    info(`User ${userId} deleted their voice bio`);
    
    return res.status(200).json({
      success: true,
      message: 'Voice bio deleted successfully'
    });
  } catch (err) {
    error(`Error in deleteVoiceBio: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error deleting voice bio'
    });
  }
};

/**
 * Get voice bio
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getVoiceBio = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('voice_bio_url')
      .eq('id', userId)
      .single();
    
    if (userError) {
      throw new Error(userError.message);
    }
    
    if (!user || !user.voice_bio_url) {
      return res.status(404).json({
        success: false,
        message: 'Voice bio not found'
      });
    }
    
    // Generate signed URL
    const signedUrl = await generateSignedUrl(user.voice_bio_url);
    
    return res.status(200).json({
      success: true,
      data: {
        url: signedUrl
      }
    });
  } catch (err) {
    error(`Error in getVoiceBio: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error fetching voice bio'
    });
  }
};

/**
 * Get profile picture upload URL
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getProfilePictureUploadUrl = async (req, res) => {
  try {
    // Try to get userId from multiple sources
    let userId = req.user?.id;
    
    // If userId is not in req.user, check headers
    if (!userId) {
      userId = req.headers['x-user-id'] || req.headers['user-id'] || req.query.userId;
      console.log(`Using userId from headers/query for upload URL: ${userId}`);
    }
    
    // Validate user ID
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Authentication may have failed.'
      });
    }
    
    const contentType = req.query.contentType || 'image/jpeg';
    
    // Validate content type
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Content type must be an image'
      });
    }

    // Generate a unique key for the file
    const key = `profile-pictures/${userId}/${Date.now()}.${contentType.split('/')[1]}`;
    
    // Generate a pre-signed URL for uploading
    const uploadUrl = await generateUploadUrl(key, contentType, 300); // 5 min expiry

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        key
      }
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL'
    });
  }
};

/**
 * Update profile picture in user profile
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateProfilePicture = async (req, res) => {
  try {
    // Try to get userId from multiple sources
    let userId = req.user?.id;
    
    // If userId is not in req.user, check headers
    if (!userId) {
      userId = req.headers['x-user-id'] || req.headers['user-id'] || req.query.userId;
      console.log(`Attempting to use userId from headers/query: ${userId}`);
    }
    
    // Validate user ID
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID is required. Authentication may have failed.'
      });
    }

    const { key } = req.body;
    
    // Check if this is a delete operation (key is explicitly null)
    const isDeleteOperation = key === null;
    
    // Only require key for update operations, not for delete operations
    if (!isDeleteOperation && !key) {
      return res.status(400).json({
        success: false,
        message: 'File key is required'
      });
    }
    
    // Fix case where key contains "undefined" instead of userId
    let correctedKey = key;
    if (!isDeleteOperation && key.includes('/undefined/')) {
      console.log(`Fixing key with undefined userId: ${key}`);
      const keyParts = key.split('/');
      if (keyParts.length >= 3) {
        keyParts[1] = userId;
        correctedKey = keyParts.join('/');
        console.log(`Corrected key: ${correctedKey}`);
      }
    }

    // Get user's current profile picture
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('profile_picture_url')
      .eq('id', userId)
      .single();

    // Check if user exists
    if (userError || !user) {
      console.error('Error fetching user:', userError);
      // Continue with update even if we can't find the current profile picture
    }
    // Delete old profile picture if exists
    else if (user.profile_picture_url) {
      try {
        const oldKey = user.profile_picture_url.split('/').slice(3).join('/');
        await deleteFile(oldKey);
      } catch (deleteError) {
        console.error('Error deleting old profile picture:', deleteError);
        // Continue with update even if delete fails
      }
    }

    // Prepare the update data
    let updateData = {
      updated_at: new Date()
    };
    
    // If this is a delete operation, set profile_picture_url to null
    if (isDeleteOperation) {
      updateData.profile_picture_url = null;
      console.log('Deleting profile picture, setting URL to null');
    } else {
      // Otherwise set to the new URL
      updateData.profile_picture_url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${correctedKey}`;
    }
    
    // Update profile picture URL in database
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating profile picture:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile picture'
      });
    }

    // Remove password from response
    delete updatedUser.password;

    return res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('Profile picture update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during profile picture update'
    });
  }
};

module.exports = {
  getUserProfile,
  updateProfile,
  uploadVoiceBio,
  deleteVoiceBio,
  getVoiceBio,
  getProfilePictureUploadUrl,
  updateProfilePicture
}; 