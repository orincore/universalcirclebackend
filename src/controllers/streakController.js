const streakService = require('../services/streakService');
const logger = require('../utils/logger');

/**
 * Get all active streaks for the current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMyActiveStreaks = async (req, res) => {
  try {
    const userId = req.user.id;
    const streaks = await streakService.getUserActiveStreaks(userId);
    
    return res.status(200).json({
      success: true,
      data: streaks
    });
  } catch (error) {
    logger.error(`Error getting active streaks: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving active streaks'
    });
  }
};

/**
 * Get a specific user's streak with the current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getStreakWithUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const streak = await streakService.getStreakBetweenUsers(currentUserId, userId);
    
    return res.status(200).json({
      success: true,
      data: streak
    });
  } catch (error) {
    logger.error(`Error getting streak with user: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving streak'
    });
  }
};

/**
 * Get streak details for a specific conversation
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getConversationStreak = async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'Conversation ID is required'
      });
    }
    
    const streak = await streakService.getConversationStreak(conversationId);
    
    return res.status(200).json({
      success: true,
      data: streak
    });
  } catch (error) {
    logger.error(`Error getting conversation streak: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving streak'
    });
  }
};

/**
 * Get all available streak bonuses
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getStreakBonuses = async (req, res) => {
  try {
    const bonuses = await streakService.getStreakBonuses();
    
    return res.status(200).json({
      success: true,
      data: bonuses
    });
  } catch (error) {
    logger.error(`Error getting streak bonuses: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving streak bonuses'
    });
  }
};

/**
 * Get user's milestone achievements
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMyMilestones = async (req, res) => {
  try {
    const userId = req.user.id;
    const milestones = await streakService.getUserStreakMilestones(userId);
    
    return res.status(200).json({
      success: true,
      data: milestones
    });
  } catch (error) {
    logger.error(`Error getting streak milestones: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving streak milestones'
    });
  }
};

/**
 * For admins: Find conversations with streaks about to expire
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getExpiringStreaks = async (req, res) => {
  try {
    // Ensure this is only accessible by admins
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const { hoursLower = 20, hoursUpper = 23 } = req.query;
    
    const expiringStreaks = await streakService.findExpiringStreaks(
      parseInt(hoursLower),
      parseInt(hoursUpper)
    );
    
    return res.status(200).json({
      success: true,
      data: expiringStreaks
    });
  } catch (error) {
    logger.error(`Error getting expiring streaks: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving expiring streaks'
    });
  }
};

module.exports = {
  getMyActiveStreaks,
  getStreakWithUser,
  getConversationStreak,
  getStreakBonuses,
  getMyMilestones,
  getExpiringStreaks
}; 