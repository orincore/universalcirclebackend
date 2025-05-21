const cron = require('node-cron');
const logger = require('../../utils/logger');
const { supabase } = require('../../config/database');
const notificationService = require('./notificationService');
const userService = require('../userService');
const { sendPersonalizedReEngagementNotifications } = require('./aiNotificationService');

/**
 * Initialize scheduled notification tasks
 */
const initScheduledNotifications = () => {
  logger.info('Starting scheduled notification system...');
  
  // Daily inactive conversation reminders - runs at 10:00 AM every day
  cron.schedule('0 10 * * *', async () => {
    await handleInactiveConversations();
  });
  
  // Streak alerts - runs every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    await handleConversationStreaks();
  });
  
  // Daily match suggestions - runs at 7:00 PM every day
  cron.schedule('0 19 * * *', async () => {
    await sendDailyMatchSuggestions();
  });
  
  // AI-powered personalized notifications - runs at 5:00 PM every day
  cron.schedule('0 17 * * *', async () => {
    await sendPersonalizedNotifications();
  });
  
  logger.info('Scheduled notification system initialized');
};

/**
 * Handle inactive conversations
 */
const handleInactiveConversations = async () => {
  try {
    logger.info('Running inactive conversation check');
    
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    // Get conversations with no messages in the last 2 days
    const { data: conversations, error: conversationError } = await supabase.rpc(
      'get_inactive_conversations',
      { inactivity_threshold: twoDaysAgo.toISOString() }
    );
    
    if (conversationError) {
      logger.error(`Error fetching inactive conversations: ${conversationError.message}`);
      return 0;
    }
    
    let notificationCount = 0;
    
    for (const conversation of conversations) {
      try {
        // Create notification for both participants
        await notificationService.createNotification(
          conversation.user1_id,
          'CONVERSATION_INACTIVE',
          {
            conversationId: conversation.id,
            userId: conversation.user2_id,
            userName: conversation.user2_name,
            userPhoto: conversation.user2_photo,
            lastMessageAt: conversation.last_message_at
          }
        );
        
        await notificationService.createNotification(
          conversation.user2_id,
          'CONVERSATION_INACTIVE',
          {
            conversationId: conversation.id,
            userId: conversation.user1_id,
            userName: conversation.user1_name,
            userPhoto: conversation.user1_photo,
            lastMessageAt: conversation.last_message_at
          }
        );
        
        notificationCount += 2;
      } catch (err) {
        logger.error(`Error processing conversation ${conversation.id}: ${err.message}`);
      }
    }
    
    logger.info(`Created ${notificationCount} inactive conversation notifications`);
    return notificationCount;
  } catch (err) {
    logger.error(`Error in handleInactiveConversations: ${err.message}`);
    return 0;
  }
};

/**
 * Handle conversation streaks
 * Notifies users who are about to lose their streak
 */
const handleConversationStreaks = async () => {
  try {
    logger.info('Running conversation streak check');
    
    // Get active streaks that might expire soon (23-24 hours since last message)
    const { data: streaks, error: streakError } = await supabase.rpc(
      'get_expiring_streaks',
      { hours_lower: 23, hours_upper: 24 }
    );
    
    if (streakError) {
      logger.error(`Error fetching expiring streaks: ${streakError.message}`);
      return 0;
    }
    
    let notificationCount = 0;
    
    for (const streak of streaks) {
      try {
        // Notify both users about the expiring streak
        await notificationService.createNotification(
          streak.user1_id,
          'STREAK_ALERT',
          {
            conversationId: streak.conversation_id,
            userId: streak.user2_id,
            userName: streak.user2_name,
            currentStreak: streak.current_streak,
            expiresAt: streak.expires_at
          }
        );
        
        await notificationService.createNotification(
          streak.user2_id,
          'STREAK_ALERT',
          {
            conversationId: streak.conversation_id,
            userId: streak.user1_id,
            userName: streak.user1_name,
            currentStreak: streak.current_streak,
            expiresAt: streak.expires_at
          }
        );
        
        notificationCount += 2;
      } catch (err) {
        logger.error(`Error processing streak for conversation ${streak.conversation_id}: ${err.message}`);
      }
    }
    
    logger.info(`Created ${notificationCount} streak alert notifications`);
    return notificationCount;
  } catch (err) {
    logger.error(`Error in handleConversationStreaks: ${err.message}`);
    return 0;
  }
};

/**
 * Send daily match suggestions to users who haven't matched with anyone today
 */
const sendDailyMatchSuggestions = async () => {
  try {
    logger.info('Sending daily match suggestions');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get users who haven't matched with anyone today
    const { data: users, error: userError } = await supabase.rpc(
      'get_users_without_matches_today',
      { today_date: today.toISOString() }
    );
    
    if (userError) {
      logger.error(`Error fetching users without matches: ${userError.message}`);
      return 0;
    }
    
    let notificationCount = 0;
    
    for (const user of users) {
      try {
        // Find potential matches for this user
        const { data: potentialMatches, error: matchError } = await supabase.rpc(
          'get_potential_matches',
          { 
            user_id: user.id,
            limit_count: 3  // Get top 3 potential matches
          }
        );
        
        if (matchError || !potentialMatches || potentialMatches.length === 0) {
          continue;
        }
        
        // Create a notification with match suggestions
        await notificationService.createNotification(
          user.id,
          'DAILY_MATCH_SUGGESTIONS',
          {
            matches: potentialMatches.map(match => ({
              userId: match.id,
              userName: match.username,
              userPhoto: match.profile_picture_url,
              compatibility: match.compatibility_score
            }))
          }
        );
        
        notificationCount++;
      } catch (err) {
        logger.error(`Error processing match suggestions for user ${user.id}: ${err.message}`);
      }
    }
    
    logger.info(`Created ${notificationCount} match suggestion notifications`);
    return notificationCount;
  } catch (err) {
    logger.error(`Error in sendDailyMatchSuggestions: ${err.message}`);
    return 0;
  }
};

/**
 * Send personalized AI-generated notifications to re-engage users
 */
const sendPersonalizedNotifications = async () => {
  try {
    logger.info('Sending AI-powered personalized notifications');
    
    // Get users who haven't been active in the last 3+ days but less than 14 days
    // (We don't want to spam very inactive users)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    const { data: inactiveUsers, error: userError } = await supabase
      .from('users')
      .select('id, username, last_active')
      .lt('last_active', threeDaysAgo.toISOString())
      .gt('last_active', twoWeeksAgo.toISOString())
      .limit(50); // Process in batches
      
    if (userError) {
      logger.error(`Error fetching inactive users: ${userError.message}`);
      return 0;
    }
    
    let notificationCount = 0;
    
    for (const user of inactiveUsers) {
      try {
        // Gather user activity data for personalized notification
        const [unreadMessages, newMatches, streakData] = await Promise.all([
          getUserUnreadMessageCount(user.id),
          getUserNewMatchCount(user.id),
          getUserMostActiveStreak(user.id)
        ]);
        
        // Skip if there's nothing interesting to notify about
        if (unreadMessages === 0 && newMatches === 0 && !streakData) {
          continue;
        }
        
        const userActivity = {
          daysSinceLogin: Math.floor((new Date() - new Date(user.last_active)) / (1000 * 60 * 60 * 24)),
          unreadMessages,
          newMatches,
          activeConversations: await getUserActiveConversationsCount(user.id),
          streakAboutToExpire: streakData ? true : false,
          currentStreakDays: streakData ? streakData.streak_days : 0
        };
        
        // Generate personalized notification using Gemini AI
        const notification = await generatePersonalizedNotification(userActivity);
        
        // Create notification with generated content
        await notificationService.createNotification(
          user.id,
          notification.type,
          {
            message: notification.text,
            priority: notification.priority
          }
        );
        
        notificationCount++;
      } catch (err) {
        logger.error(`Error processing personalized notification for user ${user.id}: ${err.message}`);
      }
    }
    
    logger.info(`Created ${notificationCount} AI-powered personalized notifications`);
    return notificationCount;
  } catch (err) {
    logger.error(`Error in sendPersonalizedNotifications: ${err.message}`);
    return 0;
  }
};

/**
 * Get user's unread message count
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Count of unread messages
 */
const getUserUnreadMessageCount = async (userId) => {
  try {
    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', userId)
      .eq('is_read', false);
      
    if (countError) {
      logger.error(`Error counting unread messages: ${countError.message}`);
      return 0;
    }
    
    return count;
  } catch (err) {
    logger.error(`Error in getUserUnreadMessageCount: ${err.message}`);
    return 0;
  }
};

/**
 * Get user's new match count
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Count of new matches
 */
const getUserNewMatchCount = async (userId) => {
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const { count, error: countError } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'accepted')
      .gt('accepted_at', threeDaysAgo.toISOString());
      
    if (countError) {
      logger.error(`Error counting new matches: ${countError.message}`);
      return 0;
    }
    
    return count;
  } catch (err) {
    logger.error(`Error in getUserNewMatchCount: ${err.message}`);
    return 0;
  }
};

/**
 * Get user's most active conversation streak
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} - Streak data or null if no active streaks
 */
const getUserMostActiveStreak = async (userId) => {
  try {
    const { data: streaks, error: streakError } = await supabase
      .from('conversation_streaks')
      .select('*')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('streak_days', { ascending: false })
      .limit(1);
      
    if (streakError) {
      logger.error(`Error fetching user streaks: ${streakError.message}`);
      return null;
    }
    
    return streaks && streaks.length > 0 ? streaks[0] : null;
  } catch (err) {
    logger.error(`Error in getUserMostActiveStreak: ${err.message}`);
    return null;
  }
};

/**
 * Get count of active conversations for a user
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Count of active conversations
 */
const getUserActiveConversationsCount = async (userId) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const { count, error: countError } = await supabase
      .rpc('get_active_conversation_count', { 
        user_id: userId,
        active_threshold: oneWeekAgo.toISOString()
      });
      
    if (countError) {
      logger.error(`Error counting active conversations: ${countError.message}`);
      return 0;
    }
    
    return count;
  } catch (err) {
    logger.error(`Error in getUserActiveConversationsCount: ${err.message}`);
    return 0;
  }
};

// Schedule for daily notification for inactive users
const scheduleReEngagementNotifications = () => {
  // Run at 5:00 PM every day (17:00)
  cron.schedule('0 17 * * *', async () => {
    try {
      logger.info('Running scheduled re-engagement notifications');
      
      // Send AI-powered personalized notifications
      const aiResult = await sendPersonalizedReEngagementNotifications();
      
      if (aiResult.success) {
        logger.info(`Successfully sent ${aiResult.count} AI-powered re-engagement notifications`);
      } else {
        logger.error('Failed to send AI-powered notifications, falling back to template-based notifications');
        
        // Get users who haven't been active in the last 7 days as fallback
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const inactiveUsers = await userService.getInactiveUsersSince(sevenDaysAgo.toISOString());
        
        if (!inactiveUsers || inactiveUsers.length === 0) {
          logger.info('No inactive users found for template-based notifications');
          return;
        }
        
        logger.info(`Found ${inactiveUsers.length} inactive users for template notifications`);
        
        for (const user of inactiveUsers) {
          try {
            // Get the number of new matches and messages for this user
            const { data: newMatches } = await notificationService.getUnreadMatchesCount(user.id);
            const { data: newMessages } = await notificationService.getUnreadMessagesCount(user.id);
            
            // Create a template-based notification
            let content = 'We miss you! Come back and check out what\'s new.';
            
            if (newMatches > 0 || newMessages > 0) {
              content = `You have ${newMatches} new matches and ${newMessages} unread messages waiting for you!`;
            }
            
            await notificationService.createNotification({
              user_id: user.id,
              type: 'RE_ENGAGEMENT',
              content: content,
              data: {
                source: 'template',
                new_matches: newMatches,
                new_messages: newMessages
              }
            });
          } catch (userError) {
            logger.error(`Failed to send template notification to user ${user.id}`, userError);
          }
        }
      }
    } catch (error) {
      logger.error('Error running scheduled re-engagement notifications', error);
    }
  });
  
  logger.info('Scheduled re-engagement notifications at 5:00 PM daily');
};

// Schedule for weekly matches digest (every Sunday at noon)
const scheduleWeeklyMatchesDigest = () => {
  cron.schedule('0 12 * * 0', async () => {
    try {
      logger.info('Running weekly matches digest');
      
      // Get active users who have opted in for weekly digests
      const { data: users, error } = await userService.getUsersWithNotificationPreference('weekly_digest', true);
      
      if (error || !users || users.length === 0) {
        logger.info('No users found with weekly digest preference enabled');
        return;
      }
      
      logger.info(`Sending weekly digest to ${users.length} users`);
      
      for (const user of users) {
        try {
          // Get matches from the past week
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
          
          const { data: weeklyMatches } = await notificationService.getMatchesSince(user.id, oneWeekAgo.toISOString());
          
          if (weeklyMatches && weeklyMatches.length > 0) {
            await notificationService.createNotification({
              user_id: user.id,
              type: 'WEEKLY_DIGEST',
              content: `You had ${weeklyMatches.length} new matches this week! Check them out!`,
              data: {
                matches_count: weeklyMatches.length,
                period: 'weekly'
              }
            });
          }
        } catch (userError) {
          logger.error(`Failed to send weekly digest to user ${user.id}`, userError);
        }
      }
    } catch (error) {
      logger.error('Error running weekly matches digest', error);
    }
  });
  
  logger.info('Scheduled weekly matches digest for Sundays at noon');
};

// Initialize all scheduled notifications
const initializeScheduledNotifications = () => {
  initScheduledNotifications();
  scheduleReEngagementNotifications();
  scheduleWeeklyMatchesDigest();
  
  logger.info('All scheduled notifications have been initialized');
};

module.exports = {
  initializeScheduledNotifications
}; 