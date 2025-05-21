const schedule = require('node-schedule');
const streakService = require('../streakService');
const supabase = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Initialize streak notification job to run daily
 */
const initializeStreakNotifications = () => {
  // Run once at midnight
  schedule.scheduleJob('0 0 * * *', async () => {
    try {
      logger.info('Running streak notifications job');
      await sendStreakMilestoneNotifications();
      logger.info('Streak milestone notifications job completed');
    } catch (error) {
      logger.error(`Error in streak milestone notifications job: ${error.message}`);
    }
  });
  
  // Run hourly to check for expiring streaks (between 20-23 hours of inactivity)
  schedule.scheduleJob('0 * * * *', async () => {
    try {
      logger.info('Running expiring streak check job');
      await sendExpiringStreakNotifications();
      logger.info('Expiring streak notifications job completed');
    } catch (error) {
      logger.error(`Error in expiring streak notifications job: ${error.message}`);
    }
  });
  
  logger.info('Streak notification jobs initialized');
};

/**
 * Send notifications for expiring streaks
 */
const sendExpiringStreakNotifications = async () => {
  try {
    // Find streaks that will expire in 20-23 hours
    const expiringStreaks = await streakService.findExpiringStreaks(20, 23);
    logger.info(`Found ${expiringStreaks.length} expiring streaks`);
    
    for (const streak of expiringStreaks) {
      // Create notifications for both users
      await createStreakNotification(
        streak.user1_id,
        'Your streak is about to expire!',
        `Your ${streak.current_streak}-day streak with ${streak.user2_name} will expire soon. Send a message to keep it going!`,
        'streak_expiring',
        {
          conversationId: streak.conversation_id,
          otherUserId: streak.user2_id,
          currentStreak: streak.current_streak,
          expiresAt: streak.expires_at
        }
      );
      
      await createStreakNotification(
        streak.user2_id,
        'Your streak is about to expire!',
        `Your ${streak.current_streak}-day streak with ${streak.user1_name} will expire soon. Send a message to keep it going!`,
        'streak_expiring',
        {
          conversationId: streak.conversation_id,
          otherUserId: streak.user1_id,
          currentStreak: streak.current_streak,
          expiresAt: streak.expires_at
        }
      );
    }
    
    return expiringStreaks.length;
  } catch (error) {
    logger.error(`Error sending expiring streak notifications: ${error.message}`);
    throw error;
  }
};

/**
 * Send notifications for streak milestones
 */
const sendStreakMilestoneNotifications = async () => {
  try {
    // Get milestone notifications that need to be sent
    const milestones = await streakService.getRecentMilestones();
    logger.info(`Found ${milestones.length} recent streak milestones`);
    
    for (const milestone of milestones) {
      // Create notifications for both users
      await createStreakNotification(
        milestone.user1_id,
        `${milestone.days_count}-Day Streak Achievement!`,
        `You and ${milestone.user2_name} have kept a conversation going for ${milestone.days_count} days! 🔥`,
        'streak_milestone',
        {
          conversationId: milestone.conversation_id,
          otherUserId: milestone.user2_id,
          daysCount: milestone.days_count,
          bonus: milestone.bonus
        }
      );
      
      await createStreakNotification(
        milestone.user2_id,
        `${milestone.days_count}-Day Streak Achievement!`,
        `You and ${milestone.user1_name} have kept a conversation going for ${milestone.days_count} days! 🔥`,
        'streak_milestone',
        {
          conversationId: milestone.conversation_id,
          otherUserId: milestone.user1_id,
          daysCount: milestone.days_count,
          bonus: milestone.bonus
        }
      );
      
      // Mark the milestone as notified
      await streakService.markMilestoneNotified(milestone.id);
    }
    
    return milestones.length;
  } catch (error) {
    logger.error(`Error sending streak milestone notifications: ${error.message}`);
    throw error;
  }
};

/**
 * Create a notification for a user
 */
const createStreakNotification = async (userId, title, message, type, metadata) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        type,
        metadata,
        is_read: false,
        created_at: new Date()
      });
    
    if (error) {
      logger.error(`Error creating streak notification: ${error.message}`);
      throw error;
    }
    
    // Real-time notification could be handled through socket here
    
  } catch (error) {
    logger.error(`Error creating streak notification: ${error.message}`);
    throw error;
  }
};

module.exports = {
  initializeStreakNotifications,
  sendExpiringStreakNotifications,
  sendStreakMilestoneNotifications
}; 