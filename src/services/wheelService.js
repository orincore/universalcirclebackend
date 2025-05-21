const supabase = require('../config/database');
const logger = require('../utils/logger');

// Constants
const SPIN_COOLDOWN_HOURS = 24; // Users can spin once every 24 hours

/**
 * Check if a user can spin the wheel today
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Spin availability information
 */
const checkSpinAvailability = async (userId) => {
  try {
    // Check if user has a spin record
    const { data: spinRecord, error: fetchError } = await supabase
      .from('user_wheel_spins')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    const now = new Date();
    
    // If no record exists or the next available spin time has passed, user can spin
    if (!spinRecord || new Date(spinRecord.next_available_spin_at) <= now) {
      return {
        canSpin: true,
        nextSpinAt: null,
        timeRemaining: 0
      };
    }
    
    // Calculate time remaining until next spin
    const nextSpinAt = new Date(spinRecord.next_available_spin_at);
    const timeRemaining = Math.max(0, nextSpinAt - now);
    const hoursRemaining = Math.ceil(timeRemaining / (1000 * 60 * 60));
    const minutesRemaining = Math.ceil((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      canSpin: false,
      nextSpinAt,
      timeRemaining,
      hoursRemaining,
      minutesRemaining
    };
  } catch (error) {
    logger.error(`Error checking spin availability for user ${userId}: ${error.message}`);
    throw error;
  }
};

/**
 * Spin the wheel and get a reward
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Wheel spin result with reward
 */
const spinWheel = async (userId) => {
  try {
    // First check if user can spin
    const spinCheck = await checkSpinAvailability(userId);
    
    if (!spinCheck.canSpin) {
      return {
        success: false,
        message: 'You cannot spin the wheel yet',
        nextSpinAt: spinCheck.nextSpinAt,
        timeRemaining: spinCheck.timeRemaining
      };
    }
    
    // Get all available rewards with their probabilities
    const { data: rewards, error: rewardsError } = await supabase
      .from('wheel_rewards')
      .select('*')
      .eq('enabled', true);
    
    if (rewardsError) {
      throw rewardsError;
    }
    
    if (!rewards || rewards.length === 0) {
      return {
        success: false,
        message: 'No rewards available at this time'
      };
    }
    
    // Calculate total probability for weighted selection
    const totalProbability = rewards.reduce((sum, reward) => sum + reward.probability, 0);
    
    // Generate a random number between 0 and total probability
    const randomValue = Math.random() * totalProbability;
    
    // Select a reward based on probability
    let selectedReward = null;
    let cumulativeProbability = 0;
    
    for (const reward of rewards) {
      cumulativeProbability += reward.probability;
      if (randomValue <= cumulativeProbability) {
        selectedReward = reward;
        break;
      }
    }
    
    // If somehow no reward was selected (should never happen), pick the first one
    if (!selectedReward && rewards.length > 0) {
      selectedReward = rewards[0];
    }
    
    // Calculate next available spin time
    const now = new Date();
    const nextSpinAt = new Date(now);
    nextSpinAt.setHours(nextSpinAt.getHours() + SPIN_COOLDOWN_HOURS);
    
    // Begin a transaction
    const { data, error } = await supabase.rpc('spin_wheel_transaction', {
      p_user_id: userId,
      p_reward_id: selectedReward.id,
      p_next_spin_at: nextSpinAt.toISOString(),
      p_expires_at: getRewardExpiryDate(selectedReward)
    });
    
    // If RPC function doesn't exist, handle manually
    if (error && error.message.includes('does not exist')) {
      // Start transaction with separate operations
      
      // Update or insert spin record
      const { data: spinRecord, error: spinError } = await supabase
        .from('user_wheel_spins')
        .select('id, total_spins')
        .eq('user_id', userId)
        .single();
      
      if (spinError && spinError.code !== 'PGRST116') {
        throw spinError;
      }
      
      if (spinRecord) {
        // Update existing record
        const { error: updateError } = await supabase
          .from('user_wheel_spins')
          .update({
            last_spin_at: now.toISOString(),
            next_available_spin_at: nextSpinAt.toISOString(),
            total_spins: spinRecord.total_spins + 1
          })
          .eq('id', spinRecord.id);
        
        if (updateError) throw updateError;
      } else {
        // Create new record
        const { error: insertError } = await supabase
          .from('user_wheel_spins')
          .insert({
            user_id: userId,
            last_spin_at: now.toISOString(),
            next_available_spin_at: nextSpinAt.toISOString(),
            total_spins: 1
          });
        
        if (insertError) throw insertError;
      }
      
      // Create reward record
      const expiryDate = getRewardExpiryDate(selectedReward);
      const { error: rewardError } = await supabase
        .from('user_rewards')
        .insert({
          user_id: userId,
          reward_id: selectedReward.id,
          expires_at: expiryDate ? expiryDate.toISOString() : null,
          created_at: now.toISOString()
        });
      
      if (rewardError) throw rewardError;
    } else if (error) {
      // Handle other errors from RPC
      throw error;
    }
    
    // Get the user's name for personalized response
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('first_name, username')
      .eq('id', userId)
      .single();
    
    const userName = user?.first_name || user?.username || 'User';
    
    // Return success with reward info
    return {
      success: true,
      reward: selectedReward,
      message: `Congratulations ${userName}! You won: ${selectedReward.name}`,
      description: selectedReward.description,
      nextSpinAt: nextSpinAt.toISOString(),
      wheelPosition: calculateWheelPosition(rewards, selectedReward)
    };
  } catch (error) {
    logger.error(`Error during wheel spin for user ${userId}: ${error.message}`);
    throw error;
  }
};

/**
 * Calculate when a reward should expire based on its type
 * @param {Object} reward - Reward object
 * @returns {Date|null} - Expiry date or null if no expiry
 */
const getRewardExpiryDate = (reward) => {
  const now = new Date();
  
  if (reward.type === 'profile_boost' || reward.type === 'message_theme') {
    // Get duration hours from value or use default 24 hours
    const durationHours = reward.value?.duration_hours || 24;
    const expiryDate = new Date(now);
    expiryDate.setHours(expiryDate.getHours() + durationHours);
    return expiryDate;
  }
  
  // Rewards with counters (super_like, conversation_starter, match_peek, extra_matches)
  // typically expire after 30 days
  if (['super_like', 'conversation_starter', 'match_peek', 'extra_matches'].includes(reward.type)) {
    const expiryDate = new Date(now);
    expiryDate.setDate(expiryDate.getDate() + 30);
    return expiryDate;
  }
  
  // Circle coins and other rewards don't expire
  return null;
};

/**
 * Get the wheel position (angle) for a reward
 * @param {Array} rewards - All rewards
 * @param {Object} selectedReward - The selected reward
 * @returns {number} - Angle for the wheel (0-360)
 */
const calculateWheelPosition = (rewards, selectedReward) => {
  // Find the index of the selected reward
  const index = rewards.findIndex(r => r.id === selectedReward.id);
  if (index === -1) return 0;
  
  // Calculate segment size and position
  const segmentSize = 360 / rewards.length;
  
  // Calculate a random angle within the reward's segment
  // This adds a little randomness to where the wheel stops
  const segmentStart = index * segmentSize;
  const randomOffset = Math.random() * (segmentSize * 0.7) + (segmentSize * 0.15);
  
  return segmentStart + randomOffset;
};

/**
 * Get all rewards for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - User's rewards
 */
const getUserRewards = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('user_rewards')
      .select(`
        *,
        reward:reward_id (*)
      `)
      .eq('user_id', userId)
      .eq('claimed', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error(`Error getting rewards for user ${userId}: ${error.message}`);
    return [];
  }
};

/**
 * Claim a user reward
 * @param {string} userId - User ID
 * @param {string} rewardId - Reward ID to claim
 */
const claimReward = async (userId, rewardId) => {
  try {
    // Verify the user owns this reward and it's not claimed
    const { data: reward, error: fetchError } = await supabase
      .from('user_rewards')
      .select('*')
      .eq('id', rewardId)
      .eq('user_id', userId)
      .eq('claimed', false)
      .single();
    
    if (fetchError || !reward) {
      return {
        success: false,
        message: 'Reward not found or already claimed'
      };
    }
    
    // Update the reward as claimed
    const { error: updateError } = await supabase
      .from('user_rewards')
      .update({
        claimed: true,
        claimed_at: new Date().toISOString()
      })
      .eq('id', rewardId);
    
    if (updateError) throw updateError;
    
    // Process the reward based on type
    // This would involve updating user data or other tables
    const rewardType = reward.reward_id;
    
    // Return success
    return {
      success: true,
      message: 'Reward claimed successfully'
    };
  } catch (error) {
    logger.error(`Error claiming reward ${rewardId} for user ${userId}: ${error.message}`);
    return {
      success: false,
      message: 'Error claiming reward'
    };
  }
};

/**
 * Get all available wheel rewards
 */
const getWheelRewards = async () => {
  try {
    const { data, error } = await supabase
      .from('wheel_rewards')
      .select('*')
      .eq('enabled', true)
      .order('probability', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error(`Error getting wheel rewards: ${error.message}`);
    return [];
  }
};

/**
 * Update all expired user rewards
 * This would be run as a scheduled job
 */
const cleanupExpiredRewards = async () => {
  try {
    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('user_rewards')
      .update({ claimed: true, claimed_at: now })
      .lt('expires_at', now)
      .eq('claimed', false);
    
    if (error) throw error;
    
    logger.info(`Cleaned up ${data?.length || 0} expired rewards`);
    return data?.length || 0;
  } catch (error) {
    logger.error(`Error cleaning up expired rewards: ${error.message}`);
    return 0;
  }
};

module.exports = {
  checkSpinAvailability,
  spinWheel,
  getUserRewards,
  claimReward,
  getWheelRewards,
  cleanupExpiredRewards,
  SPIN_COOLDOWN_HOURS
}; 