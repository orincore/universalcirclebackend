const supabase = require('../config/database');
const logger = require('../utils/logger');
const notificationService = require('./notification/notificationService');
const achievementService = require('./achievementService');

// Streak constants
const STREAK_RESET_HOURS = 24; // Streak resets after 24 hours of inactivity
const STREAK_MILESTONE_THRESHOLDS = [3, 7, 14, 30, 60, 100]; // Days when special milestone bonuses are awarded

/**
 * Create or update a conversation streak
 * Called whenever a new message is sent in a conversation
 */
const updateConversationStreak = async (conversationId, senderId, receiverId, messageTimestamp) => {
  try {
    const messageTime = new Date(messageTimestamp);
    
    // Check if this conversation already has a streak record
    const { data: existingStreak, error: fetchError } = await supabase
      .from('conversation_streaks')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // Not found error is okay
      throw fetchError;
    }
    
    // If no streak exists yet, create a new one
    if (!existingStreak) {
      const { error: insertError } = await supabase
        .from('conversation_streaks')
        .insert({
          conversation_id: conversationId,
          user1_id: senderId,
          user2_id: receiverId,
          current_streak: 1,
          longest_streak: 1,
          last_message_at: messageTime,
          streak_updated_at: new Date()
        });
      
      if (insertError) throw insertError;
      
      logger.info(`Created new streak for conversation ${conversationId}`);
      return { currentStreak: 1, isNewStreak: true, isNewDay: true };
    }
    
    // Calculate hours since last message
    const hoursDiff = (messageTime - new Date(existingStreak.last_message_at)) / (1000 * 60 * 60);
    
    // Check if message was sent in a different day (at least 8 hours later but less than STREAK_RESET_HOURS)
    const isNewDay = hoursDiff >= 8 && hoursDiff < STREAK_RESET_HOURS;
    
    // Check if streak should be reset (no messages for STREAK_RESET_HOURS)
    const shouldResetStreak = hoursDiff >= STREAK_RESET_HOURS;
    
    // Check if this message is from the same user as the last one
    const isSameUserAsLastMessage = (senderId === existingStreak.last_sender_id);
    
    let currentStreak = existingStreak.current_streak;
    let longestStreak = existingStreak.longest_streak;
    let streakIncremented = false;
    
    // Calculate new streak value
    if (shouldResetStreak) {
      // Reset streak if too much time has passed
      currentStreak = 1;
      streakIncremented = false;
    } else if (isNewDay && !isSameUserAsLastMessage) {
      // Only increment streak if it's a new day and a different user than the last message
      currentStreak += 1;
      streakIncremented = true;
      
      // Update longest streak if current streak is longer
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
    }
    
    // Update the streak record
    const { error: updateError } = await supabase
      .from('conversation_streaks')
      .update({
        current_streak: currentStreak,
        longest_streak: longestStreak,
        last_message_at: messageTime,
        last_sender_id: senderId,
        streak_updated_at: new Date()
      })
      .eq('id', existingStreak.id);
    
    if (updateError) throw updateError;
    
    // Check for milestone if streak was incremented
    if (streakIncremented && STREAK_MILESTONE_THRESHOLDS.includes(currentStreak)) {
      await recordStreakMilestone(conversationId, senderId, receiverId, currentStreak);
    }
    
    // Check for achievements for both users
    if (streakIncremented) {
      await achievementService.checkConversationStreak(senderId, conversationId, currentStreak);
      await achievementService.checkConversationStreak(receiverId, conversationId, currentStreak);
    }
    
    return { 
      currentStreak, 
      longestStreak, 
      isNewStreak: streakIncremented,
      isNewDay
    };
  } catch (error) {
    logger.error(`Error updating conversation streak for ${conversationId}: ${error.message}`);
    return { currentStreak: 1, longestStreak: 1, isNewStreak: false, isNewDay: false, error };
  }
};

/**
 * Record a streak milestone and send notifications
 */
const recordStreakMilestone = async (conversationId, user1Id, user2Id, streakCount) => {
  try {
    // Record milestone for both users
    for (const userId of [user1Id, user2Id]) {
      // Check if this user already has this milestone for this conversation
      const { data: existingMilestone, error: fetchError } = await supabase
        .from('streak_milestones')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .eq('streak_count', streakCount)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // If no milestone exists, create it and notify the user
      if (!existingMilestone) {
        // Get streak bonus information
        const { data: bonus, error: bonusError } = await supabase
          .from('streak_bonuses')
          .select('*')
          .eq('streak_count', streakCount)
          .single();
        
        // Add milestone record
        const { error: insertError } = await supabase
          .from('streak_milestones')
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            streak_count: streakCount,
            achieved_at: new Date()
          });
        
        if (insertError) throw insertError;
        
        // Get information about the other user for the notification
        const otherId = userId === user1Id ? user2Id : user1Id;
        const { data: otherUser, error: userError } = await supabase
          .from('users')
          .select('username, first_name, profile_picture_url')
          .eq('id', otherId)
          .single();
        
        if (userError) throw userError;
        
        // Send notification about the streak milestone
        await notificationService.createNotification(
          userId,
          'STREAK_MILESTONE',
          {
            conversationId,
            streakCount,
            otherUserId: otherId,
            otherUserName: otherUser.first_name || otherUser.username,
            otherUserPhoto: otherUser.profile_picture_url,
            bonus: bonus ? {
              bonusType: bonus.bonus_type,
              bonusData: bonus.bonus_data
            } : null
          }
        );
        
        logger.info(`Recorded streak milestone of ${streakCount} days for user ${userId} in conversation ${conversationId}`);
      }
    }
  } catch (error) {
    logger.error(`Error recording streak milestone: ${error.message}`);
  }
};

/**
 * Get current streak for a conversation
 */
const getConversationStreak = async (conversationId) => {
  try {
    const { data, error } = await supabase
      .from('conversation_streaks')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();
    
    if (error) throw error;
    
    if (!data) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastMessageAt: null
      };
    }
    
    return {
      currentStreak: data.current_streak,
      longestStreak: data.longest_streak,
      lastMessageAt: data.last_message_at
    };
  } catch (error) {
    logger.error(`Error getting conversation streak for ${conversationId}: ${error.message}`);
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastMessageAt: null,
      error: error.message
    };
  }
};

/**
 * Get all active conversation streaks for a user
 */
const getUserActiveStreaks = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('conversation_streaks')
      .select(`
        *,
        u1:user1_id (id, username, first_name, profile_picture_url),
        u2:user2_id (id, username, first_name, profile_picture_url)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('current_streak', { ascending: false })
      .limit(100);
    
    if (error) throw error;
    
    // Format the data for easier consumption by the client
    const formattedStreaks = data.map(streak => {
      const isUser1 = streak.user1_id === userId;
      const otherUser = isUser1 ? streak.u2 : streak.u1;
      
      return {
        conversationId: streak.conversation_id,
        currentStreak: streak.current_streak,
        longestStreak: streak.longest_streak,
        lastMessageAt: streak.last_message_at,
        otherUser: {
          id: otherUser.id,
          username: otherUser.username,
          firstName: otherUser.first_name,
          profilePictureUrl: otherUser.profile_picture_url
        }
      };
    });
    
    return formattedStreaks;
  } catch (error) {
    logger.error(`Error getting active streaks for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Get streak details between two specific users
 */
const getStreakBetweenUsers = async (userId1, userId2) => {
  try {
    const { data, error } = await supabase
      .from('conversation_streaks')
      .select('*')
      .or(`and(user1_id.eq.${userId1},user2_id.eq.${userId2}),and(user1_id.eq.${userId2},user2_id.eq.${userId1})`)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastMessageAt: null
      };
    }
    
    return {
      conversationId: data.conversation_id,
      currentStreak: data.current_streak,
      longestStreak: data.longest_streak,
      lastMessageAt: data.last_message_at
    };
  } catch (error) {
    logger.error(`Error getting streak between users ${userId1} and ${userId2}: ${error.message}`);
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastMessageAt: null,
      error: error.message
    };
  }
};

/**
 * Get all available streak bonuses
 */
const getStreakBonuses = async () => {
  try {
    const { data, error } = await supabase
      .from('streak_bonuses')
      .select('*')
      .order('streak_count', { ascending: true });
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    logger.error(`Error getting streak bonuses: ${error.message}`);
    return [];
  }
};

/**
 * Get user's streak milestones
 */
const getUserStreakMilestones = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('streak_milestones')
      .select(`
        *,
        streak_bonuses (*)
      `)
      .eq('user_id', userId)
      .order('achieved_at', { ascending: false });
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    logger.error(`Error getting streak milestones for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Find conversations with streaks about to expire
 * Used for scheduled alerts to keep streaks alive
 */
const findExpiringStreaks = async (hoursLower = 20, hoursUpper = 23) => {
  try {
    const now = new Date();
    const lowerBound = new Date(now.getTime() - (hoursUpper * 60 * 60 * 1000));
    const upperBound = new Date(now.getTime() - (hoursLower * 60 * 60 * 1000));
    
    // Find streaks where the last message was sent between lowerBound and upperBound hours ago
    const { data, error } = await supabase
      .from('conversation_streaks')
      .select(`
        *,
        u1:user1_id (id, username, first_name, profile_picture_url),
        u2:user2_id (id, username, first_name, profile_picture_url)
      `)
      .gte('last_message_at', lowerBound.toISOString())
      .lte('last_message_at', upperBound.toISOString())
      .gt('current_streak', 1) // Only care about streaks > 1
      .order('current_streak', { ascending: false });
    
    if (error) throw error;
    
    // Format the data with expiration info
    const formattedStreaks = data.map(streak => {
      const lastMessageTime = new Date(streak.last_message_at);
      const expiresAt = new Date(lastMessageTime.getTime() + (STREAK_RESET_HOURS * 60 * 60 * 1000));
      const hoursRemaining = (expiresAt - now) / (1000 * 60 * 60);
      
      return {
        conversationId: streak.conversation_id,
        currentStreak: streak.current_streak,
        longestStreak: streak.longest_streak,
        lastMessageAt: streak.last_message_at,
        expiresAt,
        hoursRemaining: Math.round(hoursRemaining),
        user1: {
          id: streak.user1_id,
          username: streak.u1.username,
          firstName: streak.u1.first_name,
          profilePictureUrl: streak.u1.profile_picture_url
        },
        user2: {
          id: streak.user2_id,
          username: streak.u2.username,
          firstName: streak.u2.first_name,
          profilePictureUrl: streak.u2.profile_picture_url
        }
      };
    });
    
    return formattedStreaks;
  } catch (error) {
    logger.error(`Error finding expiring streaks: ${error.message}`);
    return [];
  }
};

/**
 * Get recent milestone achievements that haven't been notified
 */
const getRecentMilestones = async () => {
  try {
    const { data, error } = await supabase
      .from('streak_milestones')
      .select(`
        id,
        conversation_id,
        streak_count,
        achieved_at,
        notified,
        conversation_streaks!inner(user1_id, user2_id)
      `)
      .eq('notified', false)
      .order('achieved_at', { ascending: false })
      .limit(100);
    
    if (error) throw error;
    
    // Format the data and get user details for notification
    const detailedMilestones = [];
    
    for (const milestone of data) {
      const { user1_id, user2_id } = milestone.conversation_streaks;
      
      // Get user details for both users
      const { data: user1Data, error: user1Error } = await supabase
        .from('users')
        .select('id, username, first_name')
        .eq('id', user1_id)
        .single();
      
      const { data: user2Data, error: user2Error } = await supabase
        .from('users')
        .select('id, username, first_name')
        .eq('id', user2_id)
        .single();
      
      if (user1Error || user2Error) continue;
      
      // Get bonus data if available
      const { data: bonusData } = await supabase
        .from('streak_bonuses')
        .select('*')
        .eq('streak_count', milestone.streak_count)
        .maybeSingle();
      
      detailedMilestones.push({
        id: milestone.id,
        conversation_id: milestone.conversation_id,
        days_count: milestone.streak_count,
        achieved_at: milestone.achieved_at,
        user1_id: user1_id,
        user2_id: user2_id,
        user1_name: user1Data.first_name || user1Data.username,
        user2_name: user2Data.first_name || user2Data.username,
        bonus: bonusData || null
      });
    }
    
    return detailedMilestones;
  } catch (error) {
    logger.error(`Error getting recent milestones: ${error.message}`);
    return [];
  }
};

/**
 * Mark a milestone as notified
 */
const markMilestoneNotified = async (milestoneId) => {
  try {
    const { error } = await supabase
      .from('streak_milestones')
      .update({ notified: true })
      .eq('id', milestoneId);
    
    if (error) throw error;
    
    return true;
  } catch (error) {
    logger.error(`Error marking milestone as notified: ${error.message}`);
    return false;
  }
};

module.exports = {
  updateConversationStreak,
  getConversationStreak,
  getUserActiveStreaks,
  getStreakBetweenUsers,
  getStreakBonuses,
  getUserStreakMilestones,
  findExpiringStreaks,
  getRecentMilestones,
  markMilestoneNotified,
  STREAK_RESET_HOURS,
  STREAK_MILESTONE_THRESHOLDS
}; 