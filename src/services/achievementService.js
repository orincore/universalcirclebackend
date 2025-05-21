const supabase = require('../config/database');
const logger = require('../utils/logger');
const notificationService = require('./notification/notificationService');

/**
 * Get all available achievements
 */
const getAllAchievements = async () => {
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .order('category', { ascending: true })
      .order('points', { ascending: false });
      
    if (error) throw error;
    return data;
  } catch (error) {
    logger.error(`Failed to get achievements: ${error.message}`);
    return [];
  }
};

/**
 * Get achievements by category
 */
const getAchievementsByCategory = async (category) => {
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .eq('category', category)
      .order('points', { ascending: false });
      
    if (error) throw error;
    return data;
  } catch (error) {
    logger.error(`Failed to get achievements by category ${category}: ${error.message}`);
    return [];
  }
};

/**
 * Get all achievements for a user
 */
const getUserAchievements = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select(`
        *,
        achievements (*)
      `)
      .eq('user_id', userId)
      .order('earned_at', { ascending: false });
      
    if (error) throw error;
    return data;
  } catch (error) {
    logger.error(`Failed to get achievements for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Get all completed achievements for a user
 */
const getUserCompletedAchievements = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select(`
        *,
        achievements (*)
      `)
      .eq('user_id', userId)
      .eq('completed', true)
      .order('earned_at', { ascending: false });
      
    if (error) throw error;
    return data;
  } catch (error) {
    logger.error(`Failed to get completed achievements for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Get user achievement progress
 * Returns object with total achievements and completed count
 */
const getUserAchievementProgress = async (userId) => {
  try {
    // Get total achievements count
    const { count: totalCount, error: countError } = await supabase
      .from('achievements')
      .select('id', { count: 'exact', head: true });
      
    if (countError) throw countError;
    
    // Get completed achievements count
    const { count: completedCount, error: completedError } = await supabase
      .from('user_achievements')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', true);
      
    if (completedError) throw completedError;
    
    // Get total points earned
    const { data: pointsData, error: pointsError } = await supabase
      .from('user_achievements')
      .select(`
        achievements (points)
      `)
      .eq('user_id', userId)
      .eq('completed', true);
      
    if (pointsError) throw pointsError;
    
    const totalPoints = pointsData.reduce((sum, item) => sum + (item.achievements?.points || 0), 0);
    
    return {
      total: totalCount,
      completed: completedCount,
      points: totalPoints,
      percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
    };
  } catch (error) {
    logger.error(`Failed to get achievement progress for user ${userId}: ${error.message}`);
    return { total: 0, completed: 0, points: 0, percentage: 0 };
  }
};

/**
 * Check and update achievement progress for a user
 * @param {string} userId - User ID
 * @param {string} type - Achievement requirement type
 * @param {number} count - Current count/value for the achievement
 */
const checkAchievementProgress = async (userId, type, count = 1) => {
  try {
    // Get achievements that match this requirement type
    const { data: achievements, error: achievementError } = await supabase
      .from('achievements')
      .select('*')
      .eq('requirement_type', type);
      
    if (achievementError) throw achievementError;
    
    if (!achievements || achievements.length === 0) return [];
    
    const completedAchievements = [];
    
    for (const achievement of achievements) {
      try {
        // Check if user already has this achievement tracked
        const { data: existingProgress, error: progressError } = await supabase
          .from('user_achievements')
          .select('*')
          .eq('user_id', userId)
          .eq('achievement_id', achievement.id)
          .single();
          
        if (progressError && progressError.code !== 'PGRST116') { // Not found error is okay
          throw progressError;
        }
        
        if (existingProgress?.completed) {
          // Achievement already completed, skip
          continue;
        }
        
        // Check if this update completes the achievement
        const isCompleted = count >= achievement.requirement_count;
        
        if (existingProgress) {
          // Update existing progress
          const { error: updateError } = await supabase
            .from('user_achievements')
            .update({
              progress: count,
              completed: isCompleted,
              earned_at: isCompleted ? new Date() : existingProgress.earned_at,
              notified: false // Reset notification flag if status changed
            })
            .eq('id', existingProgress.id);
            
          if (updateError) throw updateError;
          
          if (isCompleted) {
            completedAchievements.push({
              ...achievement,
              isNew: true
            });
          }
        } else {
          // Create new achievement progress entry
          const { error: insertError } = await supabase
            .from('user_achievements')
            .insert({
              user_id: userId,
              achievement_id: achievement.id,
              progress: count,
              completed: isCompleted,
              earned_at: new Date()
            });
            
          if (insertError) throw insertError;
          
          if (isCompleted) {
            completedAchievements.push({
              ...achievement,
              isNew: true
            });
          }
        }
      } catch (achError) {
        logger.error(`Error processing achievement ${achievement.id} for user ${userId}: ${achError.message}`);
      }
    }
    
    // Send notification for new completed achievements
    for (const achievement of completedAchievements) {
      try {
        await notificationService.createNotification(
          userId,
          'ACHIEVEMENT_EARNED',
          {
            achievementId: achievement.id,
            name: achievement.name,
            description: achievement.description,
            badgeIcon: achievement.badge_icon,
            badgeColor: achievement.badge_color,
            points: achievement.points
          }
        );
        
        // Mark as notified
        await supabase
          .from('user_achievements')
          .update({ notified: true })
          .eq('user_id', userId)
          .eq('achievement_id', achievement.id);
      } catch (notifyError) {
        logger.error(`Error notifying user ${userId} about achievement ${achievement.id}: ${notifyError.message}`);
      }
    }
    
    return completedAchievements;
  } catch (error) {
    logger.error(`Failed to check achievements for user ${userId} (${type}): ${error.message}`);
    return [];
  }
};

/**
 * Check and update profile completion achievement
 */
const checkProfileCompletion = async (userId) => {
  try {
    // Get user profile data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (userError) throw userError;
    
    // Define required profile fields for 100% completion
    const requiredFields = [
      'first_name', 
      'last_name', 
      'username',
      'email', 
      'bio', 
      'date_of_birth', 
      'location',
      'profile_picture_url'
    ];
    
    // Optional fields that add to completion
    const optionalFields = [
      'phone_number',
      'voice_bio_url',
      'website',
      'occupation'
    ];
    
    // Calculate completion percentage
    let filledRequiredFields = 0;
    requiredFields.forEach(field => {
      if (user[field] && user[field].toString().trim() !== '') {
        filledRequiredFields++;
      }
    });
    
    let filledOptionalFields = 0;
    optionalFields.forEach(field => {
      if (user[field] && user[field].toString().trim() !== '') {
        filledOptionalFields++;
      }
    });
    
    // Required fields make up 80% of completion, optional make up 20%
    const requiredPercentage = (filledRequiredFields / requiredFields.length) * 80;
    const optionalPercentage = (filledOptionalFields / optionalFields.length) * 20;
    const completionPercentage = Math.min(100, Math.round(requiredPercentage + optionalPercentage));
    
    // Check for profile completion achievement
    return await checkAchievementProgress(userId, 'profile_completion', completionPercentage);
  } catch (error) {
    logger.error(`Failed to check profile completion for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for login streak achievement
 */
const checkLoginStreak = async (userId, currentStreak) => {
  try {
    return await checkAchievementProgress(userId, 'login_streak', currentStreak);
  } catch (error) {
    logger.error(`Failed to check login streak for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for conversation streak achievement
 */
const checkConversationStreak = async (userId, conversationId, currentStreak) => {
  try {
    return await checkAchievementProgress(userId, 'conversation_streak', currentStreak);
  } catch (error) {
    logger.error(`Failed to check conversation streak for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Helper function to check for match-related achievements
 */
const checkMatchAchievements = async (userId) => {
  try {
    // Get total match count
    const { count: matchCount, error: countError } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'accepted');
      
    if (countError) throw countError;
    
    // Check for total matches achievement
    const totalMatchAchievements = await checkAchievementProgress(userId, 'matches', matchCount);
    
    // Count matches from the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const { count: dailyMatchCount, error: dailyError } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'accepted')
      .gte('accepted_at', oneDayAgo.toISOString());
      
    if (dailyError) throw dailyError;
    
    // Check for daily matches achievement
    const dailyMatchAchievements = await checkAchievementProgress(userId, 'daily_matches', dailyMatchCount);
    
    return [...totalMatchAchievements, ...dailyMatchAchievements];
  } catch (error) {
    logger.error(`Failed to check match achievements for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for verification achievement when a user gets verified
 */
const checkVerificationAchievement = async (userId) => {
  try {
    return await checkAchievementProgress(userId, 'verified', 1);
  } catch (error) {
    logger.error(`Failed to check verification achievement for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for voice bio achievement
 */
const checkVoiceBioAchievement = async (userId) => {
  try {
    // Check if user has a voice bio
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('voice_bio_url')
      .eq('id', userId)
      .single();
      
    if (userError) throw userError;
    
    const hasVoiceBio = user && user.voice_bio_url ? 1 : 0;
    return await checkAchievementProgress(userId, 'voice_bio', hasVoiceBio);
  } catch (error) {
    logger.error(`Failed to check voice bio achievement for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for conversation started achievement
 */
const checkConversationsStarted = async (userId) => {
  try {
    // Get count of conversations started by this user
    const { count, error } = await supabase
      .from('messages')
      .select('conversation_id', { count: 'exact', head: true, distinct: true })
      .eq('sender_id', userId);
      
    if (error) throw error;
    
    return await checkAchievementProgress(userId, 'conversations_started', count || 0);
  } catch (error) {
    logger.error(`Failed to check conversations started for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for profile pictures achievement
 */
const checkProfilePictures = async (userId) => {
  try {
    // In real implementation, you would count from a photos or gallery table
    // For this example, we'll just check if they have a profile picture
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('profile_picture_url')
      .eq('id', userId)
      .single();
      
    if (userError) throw userError;
    
    const hasPicture = user && user.profile_picture_url ? 1 : 0;
    return await checkAchievementProgress(userId, 'profile_pictures', hasPicture);
  } catch (error) {
    logger.error(`Failed to check profile pictures for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check early adopter achievement for new users
 */
const checkEarlyAdopter = async (userId, createdAt) => {
  try {
    // Get app launch date (hardcoded example - in real app, would be from settings)
    const appLaunchDate = new Date('2024-01-01'); // Example launch date
    const userCreationDate = new Date(createdAt);
    
    // Check if user joined within 30 days of launch
    const timeDifference = userCreationDate - appLaunchDate;
    const daysDifference = timeDifference / (1000 * 60 * 60 * 24);
    
    const isEarlyAdopter = daysDifference <= 30 ? 1 : 0;
    return await checkAchievementProgress(userId, 'early_adopter', isEarlyAdopter);
  } catch (error) {
    logger.error(`Failed to check early adopter status for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for mini-game completion achievements
 * @param {string} userId - User ID
 */
const checkMiniGameCompletion = async (userId) => {
  try {
    // Count completed games for this user
    const { data: gameCount, error: countError } = await supabase
      .from('game_instances')
      .select('id', { count: 'exact', head: true })
      .or(`initiator_id.eq.${userId},responder_id.eq.${userId}`)
      .eq('status', 'completed');
      
    if (countError) throw countError;
    
    // Map game count to achievement thresholds
    const count = gameCount || 0;
    const thresholds = [
      { count: 1, achievement: 'first_mini_game' },
      { count: 5, achievement: 'mini_game_enthusiast' },
      { count: 20, achievement: 'game_master' }
    ];
    
    // Check each threshold
    const unlockedAchievements = [];
    for (const threshold of thresholds) {
      if (count >= threshold.count) {
        const result = await checkAchievementProgress(userId, threshold.achievement, 1);
        if (result && result.length > 0) {
          unlockedAchievements.push(...result);
        }
      }
    }
    
    return unlockedAchievements;
  } catch (error) {
    logger.error(`Failed to check mini-game completion for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Check for mini-game win achievements
 * @param {string} userId - User ID
 */
const checkMiniGameWin = async (userId) => {
  try {
    // Count wins (we determine wins by checking if the user's score was higher)
    const { data: games, error: gamesError } = await supabase
      .from('game_instances')
      .select('*')
      .or(`initiator_id.eq.${userId},responder_id.eq.${userId}`)
      .eq('status', 'completed');
      
    if (gamesError) throw gamesError;
    
    // Count wins
    let winCount = 0;
    if (games) {
      winCount = games.filter(game => {
        const isInitiator = game.initiator_id === userId;
        const userScore = isInitiator ? (game.score[userId] || 0) : (game.score[userId] || 0);
        const opponentId = isInitiator ? game.responder_id : game.initiator_id;
        const opponentScore = game.score[opponentId] || 0;
        
        return userScore > opponentScore;
      }).length;
    }
    
    // Map win count to achievement thresholds
    const thresholds = [
      { count: 1, achievement: 'first_game_win' },
      { count: 5, achievement: 'winning_streak' },
      { count: 15, achievement: 'game_champion' }
    ];
    
    // Check each threshold
    const unlockedAchievements = [];
    for (const threshold of thresholds) {
      if (winCount >= threshold.count) {
        const result = await checkAchievementProgress(userId, threshold.achievement, 1);
        if (result && result.length > 0) {
          unlockedAchievements.push(...result);
        }
      }
    }
    
    return unlockedAchievements;
  } catch (error) {
    logger.error(`Failed to check mini-game wins for user ${userId}: ${error.message}`);
    return [];
  }
};

module.exports = {
  getAllAchievements,
  getAchievementsByCategory,
  getUserAchievements,
  getUserCompletedAchievements,
  getUserAchievementProgress,
  checkAchievementProgress,
  checkProfileCompletion,
  checkLoginStreak,
  checkConversationStreak,
  checkMatchAchievements,
  checkVerificationAchievement,
  checkVoiceBioAchievement,
  checkConversationsStarted,
  checkProfilePictures,
  checkEarlyAdopter,
  checkMiniGameCompletion,
  checkMiniGameWin
}; 