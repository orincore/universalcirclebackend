const { 
  getUserNotifications: fetchUserNotifications, 
  markNotificationRead, 
  deleteNotification: removeNotification 
} = require('../services/notification/notificationService');
const supabase = require('../config/database');
const logger = require('../utils/logger');
const { sendUserNotification } = require('../services/firebase/notificationService');

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
    logger.error(`Error in getUserNotifications controller: ${err.message}`);
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
    logger.error(`Error in markNotificationAsRead controller: ${err.message}`);
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
    logger.error(`Error in deleteNotification controller: ${err.message}`);
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
      logger.error(`Error marking all notifications as read: ${updateError.message}`);
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
    logger.error(`Error in markAllNotificationsAsRead controller: ${err.message}`);
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
      logger.error(`Error counting unread notifications: ${countError.message}`);
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
    logger.error(`Error in getUnreadCount controller: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error counting notifications'
    });
  }
};

/**
 * Register device token for push notifications
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const registerDeviceToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, deviceType, deviceName, appVersion } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }
    
    // Check if token already exists for this user to avoid duplicates
    const { data: existingToken, error: checkError } = await supabase
      .from('device_tokens')
      .select('id')
      .eq('user_id', userId)
      .eq('token', token)
      .limit(1);
    
    if (checkError) {
      logger.error(`Error checking device token: ${checkError.message}`, { userId });
      throw checkError;
    }
    
    // If token exists, update it
    if (existingToken && existingToken.length > 0) {
      const { error: updateError } = await supabase
        .from('device_tokens')
        .update({
          device_type: deviceType || null,
          device_name: deviceName || null,
          app_version: appVersion || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingToken[0].id);
      
      if (updateError) {
        logger.error(`Error updating device token: ${updateError.message}`, { userId });
        throw updateError;
      }
      
      logger.info(`Updated device token for user ${userId}`);
      
      return res.json({
        success: true,
        message: 'Device token updated successfully'
      });
    }
    
    // If token doesn't exist, insert it
    const { error: insertError } = await supabase
      .from('device_tokens')
      .insert({
        user_id: userId,
        token,
        device_type: deviceType || null,
        device_name: deviceName || null,
        app_version: appVersion || null
      });
    
    if (insertError) {
      logger.error(`Error registering device token: ${insertError.message}`, { userId });
      throw insertError;
    }
    
    logger.info(`Registered new device token for user ${userId}`);
    
    return res.json({
      success: true,
      message: 'Device token registered successfully'
    });
  } catch (error) {
    logger.error('Error in registerDeviceToken:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to register device token',
      error: error.message
    });
  }
};

/**
 * Unregister device token
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const unregisterDeviceToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }
    
    // Delete the token
    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
    
    if (error) {
      logger.error(`Error unregistering device token: ${error.message}`, { userId });
      throw error;
    }
    
    logger.info(`Unregistered device token for user ${userId}`);
    
    return res.json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (error) {
    logger.error('Error in unregisterDeviceToken:');
    return res.status(500).json({
      success: false,
      message: 'Failed to unregister device token',
      error: error.message
    });
  }
};

/**
 * Get notification settings for a user
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user's notification settings
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    // If no settings found, create default settings
    if (error && error.code === 'PGRST116') {
      // Create default settings
      const defaults = {
        user_id: userId,
        messages_enabled: true,
        matches_enabled: true,
        likes_enabled: true,
        system_enabled: true,
        promotional_enabled: true
      };
      
      const { data: newSettings, error: insertError } = await supabase
        .from('user_notification_settings')
        .insert(defaults)
        .select()
        .single();
      
      if (insertError) {
        logger.error(`Error creating notification settings: ${insertError.message}`, { userId });
        throw insertError;
      }
      
      logger.info(`Created default notification settings for user ${userId}`);
      
      return res.json({
        success: true,
        data: newSettings
      });
    }
    
    if (error) {
      logger.error(`Error fetching notification settings: ${error.message}`, { userId });
      throw error;
    }
    
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error in getNotificationSettings:');
    return res.status(500).json({
      success: false,
      message: 'Failed to get notification settings',
      error: error.message
    });
  }
};

/**
 * Update notification settings for a user
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      messages_enabled,
      matches_enabled,
      likes_enabled,
      system_enabled,
      promotional_enabled
    } = req.body;
    
    // Update settings, only include fields that were provided
    const updates = {};
    
    if (typeof messages_enabled === 'boolean') updates.messages_enabled = messages_enabled;
    if (typeof matches_enabled === 'boolean') updates.matches_enabled = matches_enabled;
    if (typeof likes_enabled === 'boolean') updates.likes_enabled = likes_enabled;
    if (typeof system_enabled === 'boolean') updates.system_enabled = system_enabled;
    if (typeof promotional_enabled === 'boolean') updates.promotional_enabled = promotional_enabled;
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid settings provided to update'
      });
    }
    
    // Check if settings exist
    const { data: existingSettings, error: checkError } = await supabase
      .from('user_notification_settings')
      .select('user_id')
      .eq('user_id', userId)
      .single();
    
    if (checkError && checkError.code === 'PGRST116') {
      // Create new settings with provided updates
      const newSettings = {
        user_id: userId,
        ...updates
      };
      
      const { data: insertedSettings, error: insertError } = await supabase
        .from('user_notification_settings')
        .insert(newSettings)
        .select()
        .single();
      
      if (insertError) {
        logger.error(`Error creating notification settings: ${insertError.message}`, { userId });
        throw insertError;
      }
      
      logger.info(`Created notification settings for user ${userId}`);
      
      return res.json({
        success: true,
        data: insertedSettings,
        message: 'Notification settings created successfully'
      });
    }
    
    // Update existing settings
    const { data: updatedSettings, error: updateError } = await supabase
      .from('user_notification_settings')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (updateError) {
      logger.error(`Error updating notification settings: ${updateError.message}`, { userId });
      throw updateError;
    }
    
    logger.info(`Updated notification settings for user ${userId}`);
    
    return res.json({
      success: true,
      data: updatedSettings,
      message: 'Notification settings updated successfully'
    });
  } catch (error) {
    logger.error('Error in updateNotificationSettings:');
    return res.status(500).json({
      success: false,
      message: 'Failed to update notification settings',
      error: error.message
    });
  }
};

/**
 * Send test notification to the user
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const sendTestNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const notification = {
      title: 'Test Notification',
      body: 'This is a test notification from Universal Circle!'
    };
    
    const data = {
      type: 'test',
      timestamp: new Date().toISOString()
    };
    
    const result = await sendUserNotification(userId, notification, data);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || 'Failed to send test notification',
        error: result.error
      });
    }
    
    return res.json({
      success: true,
      message: 'Test notification sent successfully',
      result
    });
  } catch (error) {
    logger.error('Error in sendTestNotification:');
    return res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
};

module.exports = {
  getUserNotifications,
  markNotificationAsRead,
  deleteNotification,
  markAllNotificationsAsRead,
  getUnreadCount,
  registerDeviceToken,
  unregisterDeviceToken,
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification
}; 