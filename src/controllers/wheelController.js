const wheelService = require('../services/wheelService');
const logger = require('../utils/logger');

/**
 * Check if a user can spin the wheel
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const checkAvailability = async (req, res) => {
  try {
    const userId = req.user.id;
    const availability = await wheelService.checkSpinAvailability(userId);
    
    return res.status(200).json({
      success: true,
      data: availability
    });
  } catch (error) {
    logger.error(`Error checking wheel availability: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error checking wheel availability'
    });
  }
};

/**
 * Spin the wheel and get a reward
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const spinWheel = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await wheelService.spinWheel(userId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
        nextSpinAt: result.nextSpinAt,
        timeRemaining: result.timeRemaining
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        reward: {
          id: result.reward.id,
          name: result.reward.name,
          type: result.reward.type,
          description: result.reward.description,
          value: result.reward.value
        },
        message: result.message,
        nextSpinAt: result.nextSpinAt,
        wheelPosition: result.wheelPosition
      }
    });
  } catch (error) {
    logger.error(`Error spinning wheel: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error spinning the wheel'
    });
  }
};

/**
 * Get user's active rewards
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMyRewards = async (req, res) => {
  try {
    const userId = req.user.id;
    const rewards = await wheelService.getUserRewards(userId);
    
    return res.status(200).json({
      success: true,
      data: rewards
    });
  } catch (error) {
    logger.error(`Error getting user rewards: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving rewards'
    });
  }
};

/**
 * Claim a reward
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const claimReward = async (req, res) => {
  try {
    const userId = req.user.id;
    const { rewardId } = req.params;
    
    if (!rewardId) {
      return res.status(400).json({
        success: false,
        message: 'Reward ID is required'
      });
    }
    
    const result = await wheelService.claimReward(userId, rewardId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
    
    return res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    logger.error(`Error claiming reward: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error claiming reward'
    });
  }
};

/**
 * Get all available wheel rewards for display
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getWheelRewards = async (req, res) => {
  try {
    const rewards = await wheelService.getWheelRewards();
    
    return res.status(200).json({
      success: true,
      data: rewards
    });
  } catch (error) {
    logger.error(`Error getting wheel rewards: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving wheel rewards'
    });
  }
};

/**
 * For admins: Clean up expired rewards manually
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const cleanupExpiredRewards = async (req, res) => {
  try {
    // Ensure this is only accessible by admins
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const count = await wheelService.cleanupExpiredRewards();
    
    return res.status(200).json({
      success: true,
      message: `Cleaned up ${count} expired rewards`
    });
  } catch (error) {
    logger.error(`Error cleaning up rewards: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error cleaning up rewards'
    });
  }
};

module.exports = {
  checkAvailability,
  spinWheel,
  getMyRewards,
  claimReward,
  getWheelRewards,
  cleanupExpiredRewards
}; 