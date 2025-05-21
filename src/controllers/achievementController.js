const achievementService = require('../services/achievementService');
const logger = require('../utils/logger');

/**
 * Get all available achievements
 */
const getAllAchievements = async (req, res) => {
  try {
    const achievements = await achievementService.getAllAchievements();
    
    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error(`Error getting all achievements: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievements'
    });
  }
};

/**
 * Get achievements by category
 */
const getAchievementsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category is required'
      });
    }
    
    const achievements = await achievementService.getAchievementsByCategory(category);
    
    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error(`Error getting achievements by category: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievements'
    });
  }
};

/**
 * Get current user's achievements
 */
const getCurrentUserAchievements = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const achievements = await achievementService.getUserAchievements(userId);
    
    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error(`Error getting achievements for current user: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievements'
    });
  }
};

/**
 * Get current user's completed achievements
 */
const getCurrentUserCompletedAchievements = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const achievements = await achievementService.getUserCompletedAchievements(userId);
    
    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error(`Error getting completed achievements for current user: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievements'
    });
  }
};

/**
 * Get a specific user's achievements (for profile viewing)
 */
const getUserAchievements = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const achievements = await achievementService.getUserCompletedAchievements(userId);
    
    return res.status(200).json({
      success: true,
      data: achievements
    });
  } catch (error) {
    logger.error(`Error getting achievements for user ${req.params.userId}: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievements'
    });
  }
};

/**
 * Get current user's achievement progress
 */
const getCurrentUserProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const progress = await achievementService.getUserAchievementProgress(userId);
    
    return res.status(200).json({
      success: true,
      data: progress
    });
  } catch (error) {
    logger.error(`Error getting achievement progress for current user: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve achievement progress'
    });
  }
};

/**
 * Trigger a check for profile completion achievement
 * This is called when a user updates their profile
 */
const checkProfileCompletion = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const completedAchievements = await achievementService.checkProfileCompletion(userId);
    
    return res.status(200).json({
      success: true,
      data: {
        achievementsCompleted: completedAchievements
      }
    });
  } catch (error) {
    logger.error(`Error checking profile completion for user ${req.user.id}: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to check profile completion'
    });
  }
};

/**
 * Manually check for a specific achievement type
 * Only used for debugging or admin purposes
 */
const manuallyCheckAchievement = async (req, res) => {
  try {
    // Ensure this is only callable by admins
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Only admins can manually check achievements'
      });
    }
    
    const { userId, type, count } = req.body;
    
    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        message: 'User ID and achievement type are required'
      });
    }
    
    const completedAchievements = await achievementService.checkAchievementProgress(
      userId,
      type,
      count || 1
    );
    
    return res.status(200).json({
      success: true,
      data: {
        achievementsCompleted: completedAchievements
      }
    });
  } catch (error) {
    logger.error(`Error manually checking achievement: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to manually check achievement'
    });
  }
};

module.exports = {
  getAllAchievements,
  getAchievementsByCategory,
  getCurrentUserAchievements,
  getCurrentUserCompletedAchievements,
  getUserAchievements,
  getCurrentUserProgress,
  checkProfileCompletion,
  manuallyCheckAchievement
}; 