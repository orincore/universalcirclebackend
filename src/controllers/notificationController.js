const { 
  getUserNotifications: fetchUserNotifications, 
  markNotificationRead, 
  deleteNotification: removeNotification 
} = require('../services/notification/notificationService');
const supabase = require('../config/database');
const { error } = require('../utils/logger');

/**
 * Get user notifications
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unreadOnly === 'true';
    
    const notifications = await fetchUserNotifications(userId, {
      limit, 
      offset,
      unreadOnly
    });
    
    return res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          limit,
          offset,
          hasMore: notifications.length === limit
        }
      }
    });
  } catch (err) {
    error(`Error in getUserNotifications controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
};

/**
 * Mark notification as read
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Notification ID is required'
      });
    }
    
    const success = await markNotificationRead(notificationId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or could not be updated'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (err) {
    error(`Error in markNotificationAsRead controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error marking notification as read'
    });
  }
};

/**
 * Delete notification
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: 'Notification ID is required'
      });
    }
    
    const success = await removeNotification(notificationId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found or could not be deleted'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (err) {
    error(`Error in deleteNotification controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error deleting notification'
    });
  }
};

/**
 * Mark all notifications as read
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ 
        is_read: true,
        read_at: new Date()
      })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (updateError) {
      error(`Error marking all notifications as read: ${updateError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error updating notifications'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (err) {
    error(`Error in markAllNotificationsAsRead controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error updating notifications'
    });
  }
};

/**
 * Get unread notification count
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { count, error: countError } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (countError) {
      error(`Error counting unread notifications: ${countError.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error counting notifications'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        count
      }
    });
  } catch (err) {
    error(`Error in getUnreadCount controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error counting notifications'
    });
  }
};

module.exports = {
  getUserNotifications,
  markNotificationAsRead,
  deleteNotification,
  markAllNotificationsAsRead,
  getUnreadCount
}; 