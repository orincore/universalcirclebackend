const supabase = require('../config/database');
const { error, info } = require('../utils/logger');
const { getUserById, updateUserProfile } = require('../services/userService');
const achievementService = require('../services/achievementService');
const { videoVerificationSchema, videoUploadUrlSchema } = require('../models/videoVerification');
const { generateUploadUrl } = require('../utils/awsS3');
const AWS = require('aws-sdk');

// Initialize AWS Rekognition if AWS credentials are available
let rekognition = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  rekognition = new AWS.Rekognition({
    region: process.env.AWS_REGION || 'us-east-1'
  });
}

/**
 * Request profile verification
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const requestVerification = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if verification already in progress
    const { data: existingVerification, error: fetchError } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('user_id', userId)
      .not('status', 'eq', 'rejected')
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new Error(fetchError.message);
    }

    if (existingVerification) {
      return res.status(400).json({
        success: false,
        message: `Verification already ${existingVerification.status}`,
        status: existingVerification.status
      });
    }

    // Create new verification request
    const { data: verification, error: insertError } = await supabase
      .from('verification_requests')
      .insert({
        user_id: userId,
        status: 'pending',
        requested_at: new Date()
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    info(`User ${userId} requested profile verification`);
    
    return res.status(201).json({
      success: true,
      message: 'Verification request created',
      data: {
        verification_id: verification.id,
        status: verification.status
      }
    });
  } catch (err) {
    error(`Error in requestVerification: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error processing verification request'
    });
  }
};

/**
 * Submit verification documents/data
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const submitVerification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { verification_id, verificationType, verificationData } = req.body;

    if (!verification_id || !verificationType || !verificationData) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Validate verification type
    const validTypes = ['id_document', 'email', 'phone', 'social_account'];
    if (!validTypes.includes(verificationType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification type'
      });
    }

    // Get verification request
    const { data: verificationRequest, error: fetchError } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('id', verification_id)
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found'
      });
    }

    if (verificationRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Verification already ${verificationRequest.status}`
      });
    }

    // Update verification request with submitted data
    const { error: updateError } = await supabase
      .from('verification_requests')
      .update({
        verification_type: verificationType,
        verification_data: verificationData,
        submitted_at: new Date(),
        status: 'submitted'
      })
      .eq('id', verification_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    info(`User ${userId} submitted verification data`);
    
    return res.status(200).json({
      success: true,
      message: 'Verification data submitted successfully',
      data: {
        status: 'submitted'
      }
    });
  } catch (err) {
    error(`Error in submitVerification: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error processing verification submission'
    });
  }
};

/**
 * Check verification status
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const checkVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get latest verification request
    const { data: verificationRequest, error: fetchError } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new Error(fetchError.message);
    }

    if (!verificationRequest) {
      return res.status(200).json({
        success: true,
        data: {
          status: 'none',
          message: 'No verification request found'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        verification_id: verificationRequest.id,
        status: verificationRequest.status,
        requested_at: verificationRequest.requested_at,
        submitted_at: verificationRequest.submitted_at,
        completed_at: verificationRequest.completed_at
      }
    });
  } catch (err) {
    error(`Error in checkVerificationStatus: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error checking verification status'
    });
  }
};

/**
 * Get user's verified status
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getVerifiedStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        verified: user.is_verified || false,
        verified_at: user.verified_at
      }
    });
  } catch (err) {
    error(`Error in getVerifiedStatus: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error getting verified status'
    });
  }
};

// Admin functions - will be exposed via admin routes
const approveVerification = async (req, res) => {
  try {
    const { verification_id } = req.params;
    
    // Get verification request
    const { data: verificationRequest, error: fetchError } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('id', verification_id)
      .single();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found'
      });
    }

    if (verificationRequest.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: `Verification cannot be approved (status: ${verificationRequest.status})`
      });
    }

    // Update verification request
    const { error: updateError } = await supabase
      .from('verification_requests')
      .update({
        status: 'approved',
        completed_at: new Date()
      })
      .eq('id', verification_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Update user as verified
    await updateUserProfile(verificationRequest.user_id, {
      is_verified: true,
      verified_at: new Date()
    });

    // Check for verification achievement
    await achievementService.checkVerificationAchievement(verificationRequest.user_id);

    info(`Verification ${verification_id} for user ${verificationRequest.user_id} approved`);
    
    return res.status(200).json({
      success: true,
      message: 'Verification approved successfully'
    });
  } catch (err) {
    error(`Error in approveVerification: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error approving verification'
    });
  }
};

const rejectVerification = async (req, res) => {
  try {
    const { verification_id } = req.params;
    const { rejection_reason } = req.body;
    
    if (!rejection_reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    // Get verification request
    const { data: verificationRequest, error: fetchError } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('id', verification_id)
      .single();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!verificationRequest) {
      return res.status(404).json({
        success: false,
        message: 'Verification request not found'
      });
    }

    if (verificationRequest.status !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: `Verification cannot be rejected (status: ${verificationRequest.status})`
      });
    }

    // Update verification request
    const { error: updateError } = await supabase
      .from('verification_requests')
      .update({
        status: 'rejected',
        completed_at: new Date(),
        rejection_reason
      })
      .eq('id', verification_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    info(`Verification ${verification_id} for user ${verificationRequest.user_id} rejected`);
    
    return res.status(200).json({
      success: true,
      message: 'Verification rejected successfully'
    });
  } catch (err) {
    error(`Error in rejectVerification: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting verification'
    });
  }
};

/**
 * Get a pre-signed URL for uploading verification video
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getVideoUploadUrl = async (req, res) => {
  try {
    // Validate request
    const { error: validationError, value } = videoUploadUrlSchema.validate(req.query);
    
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.details[0].message
      });
    }
    
    const userId = req.user.id;
    const contentType = value.contentType || 'video/mp4';
    
    // Generate a unique key for the file
    const key = `verification-videos/${userId}/${Date.now()}.${contentType.split('/')[1]}`;
    
    // Generate a pre-signed URL for uploading
    const uploadUrl = await generateUploadUrl(key, contentType, 600); // 10 min expiry for videos
    
    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        key
      }
    });
  } catch (err) {
    error(`Error generating video upload URL: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error generating upload URL'
    });
  }
};

/**
 * Submit a verification video for review
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const submitVerificationVideo = async (req, res) => {
  try {
    // Validate request
    const { error: validationError, value } = videoVerificationSchema.validate(req.body);
    
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.details[0].message
      });
    }
    
    const userId = req.user.id;
    const { videoKey } = value;
    
    // Check if user already has a pending or verified submission
    const { data: existingVerification, error: checkError } = await supabase
      .from('user_video_verifications')
      .select('id, status')
      .eq('user_id', userId)
      .in('status', ['pending', 'verified'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (!checkError && existingVerification) {
      // User already has a verification
      if (existingVerification.status === 'verified') {
        return res.status(400).json({
          success: false,
          message: 'User is already verified'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'User already has a pending verification request'
        });
      }
    }
    
    // Create a new verification record
    const { data: verification, error: insertError } = await supabase
      .from('user_video_verifications')
      .insert({
        user_id: userId,
        video_key: videoKey,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();
    
    if (insertError) {
      error(`Error creating verification record: ${insertError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error submitting verification request'
      });
    }
    
    // If AWS Rekognition is available, start automatic processing
    if (rekognition) {
      // This would be an async process, not waiting for completion
      processVerificationVideo(verification.id, userId, videoKey);
    }
    
    return res.status(201).json({
      success: true,
      message: 'Verification request submitted successfully',
      data: {
        id: verification.id,
        status: verification.status,
        created_at: verification.created_at
      }
    });
  } catch (err) {
    error(`Error submitting verification video: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error submitting verification request'
    });
  }
};

/**
 * Get verification status for current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get latest verification record
    const { data: verification, error: fetchError } = await supabase
      .from('user_video_verifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "Results contain 0 rows"
      error(`Error fetching verification status: ${fetchError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error fetching verification status'
      });
    }
    
    if (!verification) {
      return res.status(200).json({
        success: true,
        data: {
          verified: false,
          status: 'not_submitted',
          message: 'No verification request found'
        }
      });
    }
    
    // Prepare response based on status
    const data = {
      verified: verification.status === 'verified',
      status: verification.status,
      submitted_at: verification.created_at,
      last_updated: verification.updated_at
    };
    
    // Add rejection reason if rejected
    if (verification.status === 'rejected' && verification.rejection_reason) {
      data.rejection_reason = verification.rejection_reason;
    }
    
    return res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    error(`Error getting verification status: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving verification status'
    });
  }
};

/**
 * Delete verification request
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteVerificationRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Delete verification record
    const { error: deleteError } = await supabase
      .from('user_video_verifications')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'pending'); // Only allow deletion of pending requests
    
    if (deleteError) {
      error(`Error deleting verification request: ${deleteError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error deleting verification request'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Verification request deleted successfully'
    });
  } catch (err) {
    error(`Error deleting verification request: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error deleting verification request'
    });
  }
};

/**
 * Process verification video with AWS Rekognition (background job)
 * @param {string} verificationId - ID of the verification record
 * @param {string} userId - ID of the user
 * @param {string} videoKey - S3 key of the verification video
 */
const processVerificationVideo = async (verificationId, userId, videoKey) => {
  try {
    info(`Processing verification video for user ${userId}`);
    
    // Get user's profile picture for face comparison
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('profile_picture_url')
      .eq('id', userId)
      .single();
    
    if (userError || !user || !user.profile_picture_url) {
      error(`Cannot process verification: User has no profile picture`);
      return;
    }
    
    // TODO: Implement actual AWS Rekognition face comparison and liveness detection
    // For now, just simulate processing
    
    // Update verification record with simulated scores
    const faceMatchScore = Math.random() * 100;
    const livenessScore = Math.random() * 100;
    
    // Determine if verification passes based on thresholds
    const passes = faceMatchScore > 90 && livenessScore > 95;
    
    await supabase
      .from('user_video_verifications')
      .update({
        status: passes ? 'verified' : 'rejected',
        face_match_score: faceMatchScore,
        liveness_score: livenessScore,
        rejection_reason: passes ? null : 'Face match or liveness check failed',
        verified_at: passes ? new Date() : null,
        updated_at: new Date()
      })
      .eq('id', verificationId);
    
    info(`Verification processing completed for user ${userId} with result: ${passes ? 'PASS' : 'FAIL'}`);
  } catch (err) {
    error(`Error processing verification video: ${err.message}`);
  }
};

module.exports = {
  requestVerification,
  submitVerification,
  checkVerificationStatus,
  getVerifiedStatus,
  approveVerification,
  rejectVerification,
  getVideoUploadUrl,
  submitVerificationVideo,
  getVerificationStatus,
  deleteVerificationRequest
}; 