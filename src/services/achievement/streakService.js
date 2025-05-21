const supabase = require('../../config/database');
const { info, error } = require('../../utils/logger');
const { checkStreakAchievements } = require('./achievementService');
const { createNotification, NotificationType } = require('../notification/notificationService');

/**
 * Get conversation ID from sender and receiver IDs
 * @param {string} user1Id - First user ID
 * @param {string} user2Id - Second user ID
 * @returns {string} Normalized conversation ID
 */
const getConversationId = (user1Id, user2Id) => {
  return user1Id < user2Id 
    ? `${user1Id}_${user2Id}` 
    : `${user2Id}_${user1Id}`;
};

/**
 * Process conversation streak update when a message is sent
 * @param {string} senderId - Sender user ID
 * @param {string} receiverId - Receiver user ID
 * @returns {Promise<object>} Updated streak information
 */
const processConversationStreak = async (senderId, receiverId) => {
  try {
    const conversationId = getConversationId(senderId, receiverId);
    const now = new Date();
    
    // Get current streak record if exists
    const { data: currentStreak, error: fetchError } = await supabase
      .from('conversation_streaks')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      error(`Error fetching conversation streak: ${fetchError.message}`);
      return null;
    }
    
    let streak = {
      conversation_id: conversationId,
      user1_id: senderId < receiverId ? senderId : receiverId,
      user2_id: senderId < receiverId ? receiverId : senderId,
      streak_days: 1,
      last_message_at: now,
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours from now
      updated_at: now
    };
    
    // If existing streak, check if it's still active
    if (currentStreak) {
      const lastMessageDate = new Date(currentStreak.last_message_at);
      const daysSinceLastMessage = Math.floor((now - lastMessageDate) / (1000 * 60 * 60 * 24));
      
      if (daysSinceLastMessage <= 1) {
        // Streak is still active
        if (daysSinceLastMessage === 1) {
          // It's a new day, increase streak count
          streak.streak_days = currentStreak.streak_days + 1;
          
          // Check for achievements for both users
          await checkStreakAchievements(streak.user1_id, streak.streak_days);
          await checkStreakAchievements(streak.user2_id, streak.streak_days);
          
          // Notify both users about streak milestone
          if (streak.streak_days % 3 === 0) { // Notify on every 3rd day
            await notifyStreakMilestone(streak);
          }
        } else {
          // Same day, keep streak count
          streak.streak_days = currentStreak.streak_days;
        }
      } else {
        // Streak was broken, reset to 1 day
        streak.streak_days = 1;
        
        // Notify about streak being reset
        if (currentStreak.streak_days >= 3) {
          await notifyStreakReset(currentStreak);
        }
      }
    } else {
      // New streak, check for achievement
      await checkStreakAchievements(streak.user1_id, 1);
      await checkStreakAchievements(streak.user2_id, 1);
    }
    
    // Update or insert streak
    const { data: updatedStreak, error: upsertError } = await supabase
      .from('conversation_streaks')
      .upsert(streak)
      .select()
      .single();
    
    if (upsertError) {
      error(`Error updating conversation streak: ${upsertError.message}`);
      return null;
    }
    
    info(`Processed streak for conversation ${conversationId}: ${updatedStreak.streak_days} days`);
    return updatedStreak;
  } catch (err) {
    error(`Error in processConversationStreak: ${err.message}`);
    return null;
  }
};

/**
 * Get active streak between two users
 * @param {string} user1Id - First user ID
 * @param {string} user2Id - Second user ID
 * @returns {Promise<object|null>} Streak information or null if no streak
 */
const getActiveStreak = async (user1Id, user2Id) => {
  try {
    const conversationId = getConversationId(user1Id, user2Id);
    
    const { data: streak, error: fetchError } = await supabase
      .from('conversation_streaks')
      .select('*')
      .eq('conversation_id', conversationId)
      .single();
    
    if (fetchError) {
      if (fetchError.code === 'PGRST116') { // "no rows returned"
        return null;
      }
      error(`Error fetching active streak: ${fetchError.message}`);
      return null;
    }
    
    // Check if streak is still active
    const now = new Date();
    const expiresAt = new Date(streak.expires_at);
    
    if (now > expiresAt) {
      return null; // Streak has expired
    }
    
    return streak;
  } catch (err) {
    error(`Error in getActiveStreak: ${err.message}`);
    return null;
  }
};

/**
 * Get all active streaks for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Active streaks
 */
const getUserActiveStreaks = async (userId) => {
  try {
    const now = new Date();
    
    // Query streaks where user is involved and streak hasn't expired
    const { data: streaks, error: fetchError } = await supabase
      .from('conversation_streaks')
      .select(`
        *,
        user1:user1_id (id, username, profile_picture_url),
        user2:user2_id (id, username, profile_picture_url)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .gt('expires_at', now.toISOString())
      .order('streak_days', { ascending: false });
    
    if (fetchError) {
      error(`Error fetching user streaks: ${fetchError.message}`);
      return [];
    }
    
    // Format the streak data for easier consumption
    return streaks.map(streak => {
      const isUser1 = streak.user1_id === userId;
      return {
        conversationId: streak.conversation_id,
        streakDays: streak.streak_days,
        lastMessageAt: streak.last_message_at,
        expiresAt: streak.expires_at,
        otherUser: isUser1 ? streak.user2 : streak.user1
      };
    });
  } catch (err) {
    error(`Error in getUserActiveStreaks: ${err.message}`);
    return [];
  }
};

/**
 * Notify users about streak milestone
 * @param {object} streak - Streak data
 */
const notifyStreakMilestone = async (streak) => {
  try {
    // Get user details
    const { data: user1, error: user1Error } = await supabase
      .from('users')
      .select('username, profile_picture_url')
      .eq('id', streak.user1_id)
      .single();
      
    const { data: user2, error: user2Error } = await supabase
      .from('users')
      .select('username, profile_picture_url')
      .eq('id', streak.user2_id)
      .single();
      
    if (user1Error || user2Error) {
      error('Error fetching user details for streak notification');
      return;
    }
    
    // Create notification for user1
    await createNotification(streak.user1_id, NotificationType.STREAK_MILESTONE, {
      streakDays: streak.streak_days,
      userName: user2.username,
      userPhoto: user2.profile_picture_url,
      conversationId: streak.conversation_id
    });
    
    // Create notification for user2
    await createNotification(streak.user2_id, NotificationType.STREAK_MILESTONE, {
      streakDays: streak.streak_days,
      userName: user1.username,
      userPhoto: user1.profile_picture_url,
      conversationId: streak.conversation_id
    });
  } catch (err) {
    error(`Error in notifyStreakMilestone: ${err.message}`);
  }
};

/**
 * Notify users about streak reset
 * @param {object} streak - Streak data
 */
const notifyStreakReset = async (streak) => {
  try {
    // Get user details
    const { data: user1, error: user1Error } = await supabase
      .from('users')
      .select('username, profile_picture_url')
      .eq('id', streak.user1_id)
      .single();
      
    const { data: user2, error: user2Error } = await supabase
      .from('users')
      .select('username, profile_picture_url')
      .eq('id', streak.user2_id)
      .single();
      
    if (user1Error || user2Error) {
      error('Error fetching user details for streak reset notification');
      return;
    }
    
    // Create notification for user1
    await createNotification(streak.user1_id, NotificationType.STREAK_RESET, {
      streakDays: streak.streak_days,
      userName: user2.username,
      userPhoto: user2.profile_picture_url,
      conversationId: streak.conversation_id
    });
    
    // Create notification for user2
    await createNotification(streak.user2_id, NotificationType.STREAK_RESET, {
      streakDays: streak.streak_days,
      userName: user1.username,
      userPhoto: user1.profile_picture_url,
      conversationId: streak.conversation_id
    });
  } catch (err) {
    error(`Error in notifyStreakReset: ${err.message}`);
  }
};

module.exports = {
  processConversationStreak,
  getActiveStreak,
  getUserActiveStreaks
}; 