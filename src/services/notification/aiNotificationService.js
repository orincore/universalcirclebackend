const logger = require('../../utils/logger');
const { supabase } = require('../../config/database');
const userService = require('../userService');
const notificationService = require('./notificationService');

/**
 * Get a random re-engagement message from predefined templates
 * @param {string} userId - User ID to personalize the message
 * @returns {Promise<string>} A re-engagement message
 */
const getReEngagementMessage = async (userId) => {
  try {
    // Get user details for basic personalization
    const user = await userService.getUserById(userId);
    const firstName = user?.first_name || 'there';
    
    // Predefined re-engagement messages
    const messages = [
      `Hey ${firstName}! We've missed you. Come back and see what's new on Universal Circle!`,
      `${firstName}, there are new people waiting to connect with you. Don't miss out!`,
      `Hey ${firstName}! Your Universal Circle friends are wondering where you've been.`,
      `It's been a while, ${firstName}! Jump back in and continue your conversations.`,
      `${firstName}, you have potential matches waiting to meet you!`,
      `We've made some improvements while you were away, ${firstName}. Come check them out!`,
      `Missing your connections, ${firstName}? They're still here waiting for you.`,
      `Hey ${firstName}! Don't let your connections grow cold. Come back and chat!`
    ];
    
    // Return a random message from the list
    return messages[Math.floor(Math.random() * messages.length)];
  } catch (error) {
    logger.error(`Error generating re-engagement message for user ${userId}:`, error);
    return 'We miss you! Come back and see what\'s new on Universal Circle.';
  }
};

/**
 * Sends personalized notifications to re-engage inactive users
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
        // Generate personalized message using templates
        const reEngagementMessage = await getReEngagementMessage(user.id);
        
        // Create notification with template-based content
        await notificationService.createNotification({
          user_id: user.id,
          type: 'RE_ENGAGEMENT',
          content: reEngagementMessage,
          data: {
            source: 'template',
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