const supabase = require('../../config/database');
const { info, error } = require('../../utils/logger');
const { getUserById } = require('../../services/userService');

/**
 * Notification types
 */
const NotificationType = {
  MATCH_REMINDER: 'match_reminder',
  CONVERSATION_INACTIVE: 'conversation_inactive',
  STREAK_ALERT: 'streak_alert',
  NEW_MATCH: 'new_match',
  MESSAGE_RECEIVED: 'message_received',
  MATCH_ACCEPTED: 'match_accepted',
  PROFILE_VIEW: 'profile_view'
};

/**
 * Create a notification for a user
 * 
 * @param {string} userId - ID of the user to notify
 * @param {string} type - Type of notification from NotificationType
 * @param {object} data - Additional data for the notification
 * @param {boolean} isSilent - Whether to send without push notification
 * @returns {Promise<object>} Created notification
 */
const createNotification = async (userId, type, data = {}, isSilent = false) => {
  try {
    const notification = {
      user_id: userId,
      type,
      data,
      is_read: false,
      created_at: new Date(),
      is_silent: isSilent
    };

    const { data: createdNotification, error: createError } = await supabase
      .from('notifications')
      .insert(notification)
      .select()
      .single();

    if (createError) {
      error(`Error creating notification for user ${userId}: ${createError.message}`);
      throw createError;
    }

    // If connected to socket, send real-time notification
    const { connectedUsers, ioInstance } = require('../../socket/socketManager');
    if (connectedUsers && connectedUsers.has(userId) && ioInstance) {
      const socketId = connectedUsers.get(userId);
      ioInstance.to(socketId).emit('notification:new', createdNotification);
    }

    info(`Created notification for user ${userId} of type ${type}`);
    return createdNotification;
  } catch (err) {
    error(`Failed to create notification: ${err.message}`);
    throw err;
  }
};

/**
 * Create match reminder notifications for inactive matches
 * @returns {Promise<number>} Number of notifications created
 */
const createMatchReminders = async () => {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // Find matches where users haven't messaged in 3+ days
    const { data: inactiveMatches, error: matchError } = await supabase
      .from('matches')
      .select('id, user1_id, user2_id, last_message_at')
      .lt('last_message_at', threeDaysAgo.toISOString())
      .eq('status', 'active');

    if (matchError) {
      error(`Error finding inactive matches: ${matchError.message}`);
      return 0;
    }

    let notificationsCreated = 0;

    // Create notifications for each inactive match
    for (const match of inactiveMatches) {
      try {
        const user1 = await getUserById(match.user1_id);
        const user2 = await getUserById(match.user2_id);
        
        // Notify user1
        await createNotification(match.user1_id, NotificationType.MATCH_REMINDER, {
          matchId: match.id,
          userName: user2.username,
          userPhoto: user2.profile_picture_url,
          daysSinceActive: Math.floor((new Date() - new Date(match.last_message_at)) / (1000 * 60 * 60 * 24))
        });
        
        // Notify user2
        await createNotification(match.user2_id, NotificationType.MATCH_REMINDER, {
          matchId: match.id,
          userName: user1.username,
          userPhoto: user1.profile_picture_url,
          daysSinceActive: Math.floor((new Date() - new Date(match.last_message_at)) / (1000 * 60 * 60 * 24))
        });
        
        notificationsCreated += 2;
      } catch (err) {
        error(`Error processing match ${match.id}: ${err.message}`);
      }
    }

    return notificationsCreated;
  } catch (err) {
    error(`Error in createMatchReminders: ${err.message}`);
    return 0;
  }
};

/**
 * Mark notification as read
 * 
 * @param {string} notificationId - ID of the notification 
 * @param {string} userId - ID of the user (for verification)
 * @returns {Promise<boolean>} Success status
 */
const markNotificationRead = async (notificationId, userId) => {
  try {
    const { data, error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date() })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      error(`Error marking notification ${notificationId} as read: ${updateError.message}`);
      return false;
    }

    return true;
  } catch (err) {
    error(`Failed to mark notification as read: ${err.message}`);
    return false;
  }
};

/**
 * Get user notifications
 * 
 * @param {string} userId - User ID
 * @param {object} options - Query options
 * @returns {Promise<Array>} User notifications
 */
const getUserNotifications = async (userId, { limit = 20, offset = 0, unreadOnly = false } = {}) => {
  try {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (unreadOnly) {
      query = query.eq('is_read', false);
    }
    
    const { data: notifications, error: fetchError } = await query;

    if (fetchError) {
      error(`Error fetching notifications for user ${userId}: ${fetchError.message}`);
      return [];
    }

    return notifications;
  } catch (err) {
    error(`Failed to get user notifications: ${err.message}`);
    return [];
  }
};

/**
 * Delete a notification
 * 
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID for verification
 * @returns {Promise<boolean>} Success status
 */
const deleteNotification = async (notificationId, userId) => {
  try {
    const { error: deleteError } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (deleteError) {
      error(`Error deleting notification ${notificationId}: ${deleteError.message}`);
      return false;
    }

    return true;
  } catch (err) {
    error(`Failed to delete notification: ${err.message}`);
    return false;
  }
};

module.exports = {
  NotificationType,
  createNotification,
  createMatchReminders,
  markNotificationRead,
  getUserNotifications,
  deleteNotification
}; 