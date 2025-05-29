/**
 * Firebase Cloud Messaging notification service
 * Handles sending push notifications to user devices
 */

const { getMessaging } = require('./firebaseAdmin');
const supabase = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Send notification to a single user
 * 
 * @param {string} userId - Target user ID
 * @param {object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} - Send result
 */
const sendUserNotification = async (userId, notification, data = {}) => {
  try {
    // Get user's device tokens from database
    const { data: deviceTokens, error } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('user_id', userId);
    
    if (error || !deviceTokens || deviceTokens.length === 0) {
      logger.warn(`No device tokens found for user ${userId}`);
      return { success: false, message: 'No device tokens found for user' };
    }
    
    // Extract tokens
    const tokens = deviceTokens.map(device => device.token);
    
    // Prepare message payload
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        userId,
        timestamp: new Date().toISOString(),
      },
      tokens,
      // Optional settings for iOS and Android
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true
          }
        }
      }
    };
    
    // Send the message
    const messaging = getMessaging();
    const response = await messaging.sendMulticast(message);
    
    logger.info(`Push notification sent to user ${userId}: ${response.successCount}/${tokens.length} successful`);
    
    // Handle failed tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
          logger.error(`Error sending notification to token: ${tokens[idx]}`, resp.error);
        }
      });
      
      // Remove failed tokens from database
      if (failedTokens.length > 0) {
        await supabase
          .from('device_tokens')
          .delete()
          .in('token', failedTokens);
        
        logger.info(`Removed ${failedTokens.length} invalid device tokens`);
      }
    }
    
    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalTokens: tokens.length
    };
  } catch (error) {
    logger.error(`Failed to send notification to user ${userId}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Send message notification to a user
 * 
 * @param {string} userId - Target user ID
 * @param {object} messageData - Message data
 * @returns {Promise<object>} - Send result
 */
const sendMessageNotification = async (userId, messageData) => {
  try {
    const { sender, content, matchId, conversationId } = messageData;
    
    // Get sender details if only ID is provided
    let senderName = sender.username || sender.name || 'Someone';
    if (!senderName && sender.id) {
      const { data: senderData } = await supabase
        .from('users')
        .select('username, first_name, last_name')
        .eq('id', sender.id)
        .single();
        
      if (senderData) {
        senderName = senderData.username || 
          `${senderData.first_name || ''} ${senderData.last_name || ''}`.trim() || 
          'Someone';
      }
    }
    
    // Truncate content for notification
    const truncatedContent = content.length > 100 
      ? content.substring(0, 97) + '...' 
      : content;
    
    const notification = {
      title: senderName,
      body: truncatedContent
    };
    
    const data = {
      type: 'message',
      senderId: sender.id,
      senderName,
      messageId: messageData.id || messageData.messageId,
      matchId: matchId || null,
      conversationId: conversationId || null
    };
    
    return await sendUserNotification(userId, notification, data);
  } catch (error) {
    logger.error(`Failed to send message notification to user ${userId}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Send broadcast notification to all users
 * 
 * @param {object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {object} data - Additional data payload
 * @returns {Promise<object>} - Send result
 */
const sendBroadcastNotification = async (notification, data = {}) => {
  try {
    // Get all device tokens (with pagination for large datasets)
    const batchSize = 1000;
    let lastId = null;
    let successCount = 0;
    let failureCount = 0;
    let processedUsers = 0;
    
    // This is a utility function to process batches of tokens
    const processBatch = async () => {
      let query = supabase
        .from('device_tokens')
        .select('id, token, user_id')
        .order('id', { ascending: true })
        .limit(batchSize);
        
      // Apply pagination using 'id > last_id' pattern
      if (lastId) {
        query = query.gt('id', lastId);
      }
      
      const { data: tokens, error } = await query;
      
      if (error) {
        logger.error('Error fetching device tokens:', error);
        return { done: true, error };
      }
      
      if (!tokens || tokens.length === 0) {
        return { done: true };
      }
      
      // Group tokens by user to avoid duplicate notifications
      const userTokensMap = tokens.reduce((acc, item) => {
        if (!acc[item.user_id]) {
          acc[item.user_id] = [];
        }
        acc[item.user_id].push(item.token);
        return acc;
      }, {});
      
      // Process each user's tokens in batches of 500 (FCM limit)
      const fcmBatchSize = 500;
      const messaging = getMessaging();
      
      for (const userId in userTokensMap) {
        const userTokens = userTokensMap[userId];
        processedUsers++;
        
        // Split into batches if needed
        for (let i = 0; i < userTokens.length; i += fcmBatchSize) {
          const tokenBatch = userTokens.slice(i, i + fcmBatchSize);
          
          // Prepare message
          const message = {
            notification: {
              title: notification.title,
              body: notification.body,
            },
            data: {
              ...data,
              type: 'broadcast',
              timestamp: new Date().toISOString(),
              adminGenerated: 'true'
            },
            tokens: tokenBatch,
            android: {
              priority: 'high',
              notification: {
                sound: 'default',
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
              }
            },
            apns: {
              payload: {
                aps: {
                  sound: 'default',
                  badge: 1,
                  contentAvailable: true
                }
              }
            }
          };
          
          // Send the message batch
          try {
            const response = await messaging.sendMulticast(message);
            successCount += response.successCount;
            failureCount += response.failureCount;
            
            // Handle failed tokens
            if (response.failureCount > 0) {
              const failedTokens = [];
              response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                  failedTokens.push(tokenBatch[idx]);
                }
              });
              
              // Remove invalid tokens
              if (failedTokens.length > 0) {
                await supabase
                  .from('device_tokens')
                  .delete()
                  .in('token', failedTokens);
                
                logger.info(`Removed ${failedTokens.length} invalid device tokens`);
              }
            }
          } catch (error) {
            logger.error('Error sending FCM notification batch:', error);
            failureCount += tokenBatch.length;
          }
        }
      }
      
      // Update lastId for next pagination call
      if (tokens.length > 0) {
        lastId = tokens[tokens.length - 1].id;
      }
      
      return { 
        done: tokens.length < batchSize,
        usersProcessed: processedUsers
      };
    };
    
    // Process batches until done
    let batchResult;
    do {
      batchResult = await processBatch();
      logger.info(`Processed broadcast notification batch: ${batchResult.usersProcessed} users processed so far`);
    } while (!batchResult.done);
    
    // Store broadcast notification in database for history
    await supabase
      .from('admin_notifications')
      .insert({
        title: notification.title,
        body: notification.body,
        data: data,
        sent_at: new Date().toISOString(),
        success_count: successCount,
        failure_count: failureCount,
        sent_by: data.adminId || null
      });
    
    logger.info(`Broadcast notification sent: ${successCount} successful, ${failureCount} failed`);
    
    return {
      success: true,
      successCount,
      failureCount,
      usersReached: processedUsers
    };
  } catch (error) {
    logger.error('Failed to send broadcast notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send a notification to a topic
 * 
 * @param {string} topic - The topic to send to
 * @param {object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {object} data - Additional data payload 
 * @returns {Promise<object>} - Send result
 */
const sendTopicNotification = async (topic, notification, data = {}) => {
  try {
    // Prepare message
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        timestamp: new Date().toISOString()
      },
      topic,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: true
          }
        }
      }
    };
    
    // Send the message
    const messaging = getMessaging();
    const response = await messaging.send(message);
    
    logger.info(`Push notification sent to topic ${topic}`);
    
    return {
      success: true,
      messageId: response
    };
  } catch (error) {
    logger.error(`Failed to send notification to topic ${topic}:`, error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendUserNotification,
  sendMessageNotification,
  sendBroadcastNotification,
  sendTopicNotification
}; 