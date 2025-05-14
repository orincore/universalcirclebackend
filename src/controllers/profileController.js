const supabase = require('../config/database');
const { profileUpdateSchema } = require('../models/user');
const { generateUploadUrl, deleteFile } = require('../utils/awsS3');
const { validateInterests } = require('../utils/interests');

/**
 * Update user profile
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateProfile = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = profileUpdateSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const userId = req.user.id;
    const updateData = {};
    
    // Only include fields that were provided in the request
    if (value.firstName) updateData.first_name = value.firstName;
    if (value.lastName) updateData.last_name = value.lastName;
    if (value.preference) updateData.preference = value.preference;
    if (value.interests) updateData.interests = value.interests;
    if (value.location) updateData.location = value.location;
    if (value.bio) updateData.bio = value.bio;
    
    // Add updated_at timestamp
    updateData.updated_at = new Date();

    // Update user in database
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating profile:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }

    // Remove password from response
    delete updatedUser.password;

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during profile update'
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
    const userId = req.user.id;
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
    const userId = req.user.id;
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'File key is required'
      });
    }

    // Get user's current profile picture
    const { data: user } = await supabase
      .from('users')
      .select('profile_picture_url')
      .eq('id', userId)
      .single();

    // Delete old profile picture if exists
    if (user.profile_picture_url) {
      try {
        const oldKey = user.profile_picture_url.split('/').slice(3).join('/');
        await deleteFile(oldKey);
      } catch (deleteError) {
        console.error('Error deleting old profile picture:', deleteError);
        // Continue with update even if delete fails
      }
    }

    // Update profile picture URL in database
    const profilePictureUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        profile_picture_url: profilePictureUrl,
        updated_at: new Date()
      })
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
  updateProfile,
  getProfilePictureUploadUrl,
  updateProfilePicture
}; 