const logger = require('../../utils/logger');
const { supabase } = require('../../config/database');
const { generateReEngagementMessage } = require('../ai/aiCopilotService');
const userService = require('../userService');
const notificationService = require('./notificationService');

/**
 * Sends AI-generated personalized notifications to re-engage inactive users
 * @returns {Promise<{success: boolean, count: number, error: any}>}
 */
const sendPersonalizedReEngagementNotifications = async () => {
  try {
    logger.info('Starting personalized re-engagement notification process');
    
    // Get users who have been inactive for 3-7 days
    const currentDate = new Date();
    const threeDaysAgo = new Date(currentDate);
    threeDaysAgo.setDate(currentDate.getDate() - 3);
    
    const sevenDaysAgo = new Date(currentDate);
    sevenDaysAgo.setDate(currentDate.getDate() - 7);
    
    const inactiveUsers = await userService.getInactiveUsersSince(sevenDaysAgo.toISOString(), threeDaysAgo.toISOString());
    
    if (!inactiveUsers || inactiveUsers.length === 0) {
      logger.info('No inactive users found for re-engagement');
      return { success: true, count: 0 };
    }
    
    logger.info(`Found ${inactiveUsers.length} inactive users for re-engagement notifications`);
    
    let successCount = 0;
    
    // Process each inactive user
    for (const user of inactiveUsers) {
      try {
        // Generate personalized message using AI
        const reEngagementMessage = await generateReEngagementMessage(user.id);
        
        // Create notification with AI-generated content
        await notificationService.createNotification({
          user_id: user.id,
          type: 'RE_ENGAGEMENT',
          content: reEngagementMessage,
          data: {
            source: 'ai_personalized',
            generated_at: new Date().toISOString()
          }
        });
        
        successCount++;
      } catch (userError) {
        logger.error(`Failed to send re-engagement notification to user ${user.id}`, userError);
        // Continue with the next user even if one fails
      }
    }
    
    logger.info(`Successfully sent ${successCount} personalized re-engagement notifications`);
    return {
      success: true,
      count: successCount
    };
  } catch (error) {
    logger.error('Error in sendPersonalizedReEngagementNotifications', error);
    return {
      success: false,
      count: 0,
      error
    };
  }
};

module.exports = {
  sendPersonalizedReEngagementNotifications
}; 