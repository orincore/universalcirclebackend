const supabase = require('../../config/database');
const { info, error } = require('../../utils/logger');
const { createNotification, NotificationType } = require('../notification/notificationService');

/**
 * Achievement types
 */
const AchievementType = {
  // Connection achievements
  FIRST_MATCH: 'first_match',
  FIVE_MATCHES: 'five_matches',
  TWENTY_MATCHES: 'twenty_matches',
  
  // Message achievements
  FIRST_MESSAGE: 'first_message',
  HUNDRED_MESSAGES: 'hundred_messages',
  THOUSAND_MESSAGES: 'thousand_messages',
  
  // Streak achievements
  THREE_DAY_STREAK: 'three_day_streak',
  SEVEN_DAY_STREAK: 'seven_day_streak',
  THIRTY_DAY_STREAK: 'thirty_day_streak',
  
  // Profile achievements
  COMPLETE_PROFILE: 'complete_profile',
  VERIFIED_PROFILE: 'verified_profile',
  
  // Match quality achievements
  PERFECT_MATCH: 'perfect_match',
  SUPER_CONNECTOR: 'super_connector'
};

/**
 * Achievement definitions with details
 */
const achievementDefinitions = {
  [AchievementType.FIRST_MATCH]: {
    name: 'First Connection',
    description: 'Made your first connection with someone',
    icon: 'handshake',
    points: 10
  },
  [AchievementType.FIVE_MATCHES]: {
    name: 'Social Butterfly',
    description: 'Connected with 5 people',
    icon: 'butterfly',
    points: 25
  },
  [AchievementType.TWENTY_MATCHES]: {
    name: 'Networking Star',
    description: 'Connected with 20 people',
    icon: 'star',
    points: 50
  },
  [AchievementType.FIRST_MESSAGE]: {
    name: 'Conversation Starter',
    description: 'Sent your first message',
    icon: 'message',
    points: 10
  },
  [AchievementType.HUNDRED_MESSAGES]: {
    name: 'Chatty',
    description: 'Sent 100 messages',
    icon: 'chat-dots',
    points: 30
  },
  [AchievementType.THOUSAND_MESSAGES]: {
    name: 'Communication Expert',
    description: 'Sent 1,000 messages',
    icon: 'chat-fill',
    points: 100
  },
  [AchievementType.THREE_DAY_STREAK]: {
    name: 'Getting Consistent',
    description: 'Maintained a 3-day conversation streak',
    icon: 'calendar-check',
    points: 15
  },
  [AchievementType.SEVEN_DAY_STREAK]: {
    name: 'Week Strong',
    description: 'Maintained a 7-day conversation streak',
    icon: 'calendar-week',
    points: 35
  },
  [AchievementType.THIRTY_DAY_STREAK]: {
    name: 'Monthly Dedication',
    description: 'Maintained a 30-day conversation streak',
    icon: 'calendar-month',
    points: 150
  },
  [AchievementType.COMPLETE_PROFILE]: {
    name: 'Profile Pro',
    description: 'Completed your profile with all information',
    icon: 'person-check',
    points: 15
  },
  [AchievementType.VERIFIED_PROFILE]: {
    name: 'Verified User',
    description: 'Verified your profile',
    icon: 'check-circle',
    points: 25
  },
  [AchievementType.PERFECT_MATCH]: {
    name: 'Perfect Match',
    description: 'Found a 90%+ compatibility match',
    icon: 'heart',
    points: 50
  },
  [AchievementType.SUPER_CONNECTOR]: {
    name: 'Super Connector',
    description: 'Had conversations with 50 different people',
    icon: 'people',
    points: 100
  }
};

/**
 * Check and update streak achievements
 * @param {string} userId - User ID
 * @param {number} streakDays - Current streak days
 * @returns {Promise<Array>} Newly unlocked achievements
 */
const checkStreakAchievements = async (userId, streakDays) => {
  try {
    const newAchievements = [];
    
    // Define streak achievements to check
    const streakAchievements = [
      { type: AchievementType.THREE_DAY_STREAK, threshold: 3 },
      { type: AchievementType.SEVEN_DAY_STREAK, threshold: 7 },
      { type: AchievementType.THIRTY_DAY_STREAK, threshold: 30 }
    ];
    
    // Check each streak achievement
    for (const achievement of streakAchievements) {
      if (streakDays >= achievement.threshold) {
        const unlocked = await unlockAchievement(userId, achievement.type);
        if (unlocked) {
          newAchievements.push(unlocked);
        }
      }
    }
    
    return newAchievements;
  } catch (err) {
    error(`Error checking streak achievements: ${err.message}`);
    return [];
  }
};

/**
 * Check and update message count achievements
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Newly unlocked achievements
 */
const checkMessageAchievements = async (userId) => {
  try {
    const newAchievements = [];
    
    // Get user's message count
    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', userId);
      
    if (countError) {
      error(`Error counting messages: ${countError.message}`);
      return [];
    }
    
    // Define message count achievements to check
    const messageAchievements = [
      { type: AchievementType.FIRST_MESSAGE, threshold: 1 },
      { type: AchievementType.HUNDRED_MESSAGES, threshold: 100 },
      { type: AchievementType.THOUSAND_MESSAGES, threshold: 1000 }
    ];
    
    // Check each message achievement
    for (const achievement of messageAchievements) {
      if (count >= achievement.threshold) {
        const unlocked = await unlockAchievement(userId, achievement.type);
        if (unlocked) {
          newAchievements.push(unlocked);
        }
      }
    }
    
    return newAchievements;
  } catch (err) {
    error(`Error checking message achievements: ${err.message}`);
    return [];
  }
};

/**
 * Check and update match count achievements
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Newly unlocked achievements
 */
const checkMatchAchievements = async (userId) => {
  try {
    const newAchievements = [];
    
    // Get user's match count
    const { count, error: countError } = await supabase.rpc(
      'get_match_count',
      { user_id: userId }
    );
      
    if (countError) {
      error(`Error counting matches: ${countError.message}`);
      return [];
    }
    
    // Define match count achievements to check
    const matchAchievements = [
      { type: AchievementType.FIRST_MATCH, threshold: 1 },
      { type: AchievementType.FIVE_MATCHES, threshold: 5 },
      { type: AchievementType.TWENTY_MATCHES, threshold: 20 }
    ];
    
    // Check each match achievement
    for (const achievement of matchAchievements) {
      if (count >= achievement.threshold) {
        const unlocked = await unlockAchievement(userId, achievement.type);
        if (unlocked) {
          newAchievements.push(unlocked);
        }
      }
    }
    
    return newAchievements;
  } catch (err) {
    error(`Error checking match achievements: ${err.message}`);
    return [];
  }
};

/**
 * Unlock an achievement for a user
 * @param {string} userId - User ID
 * @param {string} achievementType - Achievement type from AchievementType
 * @returns {Promise<object|null>} Unlocked achievement or null
 */
const unlockAchievement = async (userId, achievementType) => {
  try {
    // Check if user already has this achievement
    const { data: existingAchievement, error: existingError } = await supabase
      .from('user_achievements')
      .select('*')
      .eq('user_id', userId)
      .eq('achievement_type', achievementType)
      .single();
      
    if (existingError && existingError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      error(`Error checking existing achievement: ${existingError.message}`);
      return null;
    }
    
    // Return null if achievement already exists
    if (existingAchievement) {
      return null;
    }
    
    // Get achievement definition
    const achievementDef = achievementDefinitions[achievementType];
    if (!achievementDef) {
      error(`Unknown achievement type: ${achievementType}`);
      return null;
    }
    
    // Create the achievement record
    const achievement = {
      user_id: userId,
      achievement_type: achievementType,
      name: achievementDef.name,
      description: achievementDef.description,
      icon: achievementDef.icon,
      points: achievementDef.points,
      unlocked_at: new Date()
    };
    
    const { data: unlockedAchievement, error: insertError } = await supabase
      .from('user_achievements')
      .insert(achievement)
      .select()
      .single();
      
    if (insertError) {
      error(`Error unlocking achievement: ${insertError.message}`);
      return null;
    }
    
    // Update user points
    await updateUserPoints(userId, achievementDef.points);
    
    // Create notification
    await createNotification(userId, NotificationType.ACHIEVEMENT_UNLOCKED, {
      achievementType,
      name: achievementDef.name,
      description: achievementDef.description,
      icon: achievementDef.icon,
      points: achievementDef.points
    });
    
    info(`User ${userId} unlocked achievement: ${achievementType}`);
    return unlockedAchievement;
  } catch (err) {
    error(`Error unlocking achievement: ${err.message}`);
    return null;
  }
};

/**
 * Update user points
 * @param {string} userId - User ID
 * @param {number} pointsToAdd - Points to add
 */
const updateUserPoints = async (userId, pointsToAdd) => {
  try {
    // Get current points
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('achievement_points')
      .eq('id', userId)
      .single();
      
    if (userError) {
      error(`Error getting user points: ${userError.message}`);
      return;
    }
    
    const currentPoints = userData.achievement_points || 0;
    const newPoints = currentPoints + pointsToAdd;
    
    // Update points
    const { error: updateError } = await supabase
      .from('users')
      .update({ achievement_points: newPoints })
      .eq('id', userId);
      
    if (updateError) {
      error(`Error updating user points: ${updateError.message}`);
      return;
    }
    
    info(`Updated points for user ${userId}: ${currentPoints} -> ${newPoints}`);
  } catch (err) {
    error(`Error updating user points: ${err.message}`);
  }
};

/**
 * Get user achievements
 * @param {string} userId - User ID
 * @returns {Promise<Array>} User achievements
 */
const getUserAchievements = async (userId) => {
  try {
    const { data: achievements, error: fetchError } = await supabase
      .from('user_achievements')
      .select('*')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });
      
    if (fetchError) {
      error(`Error fetching user achievements: ${fetchError.message}`);
      return [];
    }
    
    return achievements;
  } catch (err) {
    error(`Error getting user achievements: ${err.message}`);
    return [];
  }
};

/**
 * Get user points
 * @param {string} userId - User ID
 * @returns {Promise<number>} User points
 */
const getUserPoints = async (userId) => {
  try {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('achievement_points')
      .eq('id', userId)
      .single();
      
    if (userError) {
      error(`Error getting user points: ${userError.message}`);
      return 0;
    }
    
    return userData.achievement_points || 0;
  } catch (err) {
    error(`Error getting user points: ${err.message}`);
    return 0;
  }
};

module.exports = {
  AchievementType,
  achievementDefinitions,
  checkStreakAchievements,
  checkMessageAchievements,
  checkMatchAchievements,
  unlockAchievement,
  getUserAchievements,
  getUserPoints
}; 