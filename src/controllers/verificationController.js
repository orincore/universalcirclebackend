const supabase = require('../config/database');
const { error, info } = require('../utils/logger');
const { getUserById, updateUserProfile } = require('../services/userService');
const achievementService = require('../services/achievementService');

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

module.exports = {
  requestVerification,
  submitVerification,
  checkVerificationStatus,
  getVerifiedStatus,
  approveVerification,
  rejectVerification
}; 