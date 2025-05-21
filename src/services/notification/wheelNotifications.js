const schedule = require('node-schedule');
const wheelService = require('../wheelService');
const supabase = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Initialize wheel notification jobs
 */
const initializeWheelNotifications = () => {
  // Clean up expired rewards once every day at 3 AM
  schedule.scheduleJob('0 3 * * *', async () => {
    try {
      logger.info('Running wheel rewards cleanup job');
      const count = await wheelService.cleanupExpiredRewards();
      logger.info(`Wheel rewards cleanup job completed: ${count} expired rewards processed`);
    } catch (error) {
      logger.error(`Error in wheel rewards cleanup job: ${error.message}`);
    }
  });
  
  // Remind users who haven't spun the wheel today at 8 PM
  schedule.scheduleJob('0 20 * * *', async () => {
    try {
      logger.info('Running wheel reminder job');
      await sendWheelReminders();
      logger.info('Wheel reminder job completed');
    } catch (error) {
      logger.error(`Error in wheel reminder job: ${error.message}`);
    }
  });
  
  logger.info('Wheel notification jobs initialized');
};

/**
 * Send reminders to users who haven't spun the wheel today
 */
const sendWheelReminders = async () => {
  try {
    // Get users who haven't spun the wheel today
    const { data: eligibleUsers, error } = await supabase.rpc(
      'get_users_eligible_for_wheel_spin',
      { hours_threshold: 24 }
    );
    
    if (error) {
      // If the RPC doesn't exist, perform query directly
      if (error.message.includes('does not exist')) {
        const now = new Date();
        
        // Find users with no spin record or whose next_available_spin_at has passed
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, first_name, username')
          .not('id', 'in', supabase
            .from('user_wheel_spins')
            .select('user_id')
            .gt('next_available_spin_at', now.toISOString())
          );
        
        if (usersError) throw usersError;
        
        // Send notifications to eligible users
        for (const user of users || []) {
          await sendWheelReminderNotification(user.id, user.first_name || user.username);
        }
        
        logger.info(`Sent wheel reminders to ${users?.length || 0} users`);
        return users?.length || 0;
      } else {
        throw error;
      }
    }
    
    // Send notifications to eligible users from RPC
    for (const user of eligibleUsers || []) {
      await sendWheelReminderNotification(user.id, user.first_name || user.username);
    }
    
    logger.info(`Sent wheel reminders to ${eligibleUsers?.length || 0} users`);
    return eligibleUsers?.length || 0;
  } catch (error) {
    logger.error(`Error sending wheel reminders: ${error.message}`);
    throw error;
  }
};

/**
 * Send a wheel reminder notification to a user
 * @param {string} userId - User ID
 * @param {string} userName - User's name
 */
const sendWheelReminderNotification = async (userId, userName) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: 'Daily Wheel Spin Available!',
        message: `Hey ${userName}! You haven't spun the wheel today. Spin now for a chance to win special rewards!`,
        type: 'wheel_reminder',
        metadata: {
          action: 'wheel_spin'
        },
        is_read: false,
        created_at: new Date()
      });
    
    if (error) {
      logger.error(`Error creating wheel reminder notification: ${error.message}`);
      throw error;
    }
    
    // Real-time notification could be handled through socket here
    
  } catch (error) {
    logger.error(`Error creating wheel reminder notification: ${error.message}`);
    throw error;
  }
};

module.exports = {
  initializeWheelNotifications,
  sendWheelReminders
}; 