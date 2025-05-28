const supabase = require('../config/database');
const { info, error } = require('../utils/logger');

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} User object or null if not found
 */
const getUserById = async (userId) => {
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (userError) {
      error(`Error fetching user by ID ${userId}: ${userError.message}`);
      return null;
    }
    
    return user;
  } catch (err) {
    error(`Error in getUserById: ${err.message}`);
    return null;
  }
};

/**
 * Update user's online status
 * @param {string} userId - User ID
 * @param {boolean} isOnline - Online status
 * @returns {Promise<boolean>} Success status
 */
const updateUserOnlineStatus = async (userId, isOnline) => {
  try {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        is_online: isOnline,
        last_active: new Date()
      })
      .eq('id', userId);
      
    if (updateError) {
      error(`Error updating user online status for ${userId}: ${updateError.message}`);
      return false;
    }
    
    return true;
  } catch (err) {
    error(`Error in updateUserOnlineStatus: ${err.message}`);
    return false;
  }
};

/**
 * Get user by username
 * @param {string} username - Username
 * @returns {Promise<object|null>} User object or null if not found
 */
const getUserByUsername = async (username) => {
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .single();
      
    if (userError) {
      error(`Error fetching user by username ${username}: ${userError.message}`);
      return null;
    }
    
    return user;
  } catch (err) {
    error(`Error in getUserByUsername: ${err.message}`);
    return null;
  }
};

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {object} profileData - Profile data to update
 * @returns {Promise<object|null>} Updated user or null on error
 */
const updateUserProfile = async (userId, profileData) => {
  try {
    // Remove any fields that shouldn't be directly updated
    const { id, created_at, updated_at, email, ...safeProfileData } = profileData;
    
    safeProfileData.updated_at = new Date();
    
    // Log the profile data being sent to the database
    console.log(`Updating user ${userId} with profile data:`, JSON.stringify(safeProfileData));
    
    // Ensure interests is properly formatted as an array if present
    if (safeProfileData.interests !== undefined) {
      // If interests is a string, try to parse it as JSON
      if (typeof safeProfileData.interests === 'string') {
        try {
          safeProfileData.interests = JSON.parse(safeProfileData.interests);
          console.log('Parsed interests from string:', safeProfileData.interests);
        } catch (e) {
          console.error('Failed to parse interests string:', e.message);
          // If parsing fails, split by comma as fallback
          safeProfileData.interests = safeProfileData.interests.split(',').map(i => i.trim());
          console.log('Split interests by comma:', safeProfileData.interests);
        }
      }
      
      // Make sure interests is an array
      if (!Array.isArray(safeProfileData.interests)) {
        console.log('Converting non-array interests to array:', safeProfileData.interests);
        safeProfileData.interests = [safeProfileData.interests];
      }
      
      console.log('Final interests array:', safeProfileData.interests);
    }
    
    // Handle preferences object (often used for notification settings, etc.)
    if (safeProfileData.preferences !== undefined) {
      // If preferences is a string, try to parse it as JSON
      if (typeof safeProfileData.preferences === 'string') {
        try {
          safeProfileData.preferences = JSON.parse(safeProfileData.preferences);
          console.log('Parsed preferences from string:', safeProfileData.preferences);
        } catch (e) {
          console.error('Failed to parse preferences string:', e.message);
          // Keep as string if parsing fails
        }
      }
    }
    
    // Handle singular preference field
    if (safeProfileData.preference !== undefined) {
      // Ensure preference is a string (if it's an object or something else, stringify it)
      if (typeof safeProfileData.preference !== 'string') {
        safeProfileData.preference = String(safeProfileData.preference);
        console.log('Converted preference to string:', safeProfileData.preference);
      }
    }
    
    // Handle location object
    if (safeProfileData.location !== undefined) {
      // If location is a string, try to parse it as JSON
      if (typeof safeProfileData.location === 'string') {
        try {
          safeProfileData.location = JSON.parse(safeProfileData.location);
          console.log('Parsed location from string:', safeProfileData.location);
        } catch (e) {
          console.error('Failed to parse location string:', e.message);
          // Keep as string if parsing fails
        }
      }
      
      // Ensure location has at least latitude and longitude
      if (typeof safeProfileData.location === 'object' && safeProfileData.location !== null) {
        // Check if it has the right properties
        if (!safeProfileData.location.hasOwnProperty('latitude') || !safeProfileData.location.hasOwnProperty('longitude')) {
          console.error('Location object missing required properties (latitude/longitude):', safeProfileData.location);
        }
      }
    }
    
    // Handle date fields
    if (safeProfileData.birth_date !== undefined && typeof safeProfileData.birth_date === 'string') {
      try {
        // Ensure it's a valid date
        const date = new Date(safeProfileData.birth_date);
        if (!isNaN(date.getTime())) {
          // Convert to ISO string for database consistency
          safeProfileData.birth_date = date.toISOString().split('T')[0];
          console.log('Formatted birth_date:', safeProfileData.birth_date);
        }
      } catch (e) {
        console.error('Failed to format birth_date:', e.message);
      }
    }
    
    // Log final data
    console.log('Final update data:', JSON.stringify(safeProfileData));
    
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(safeProfileData)
      .eq('id', userId)
      .select()
      .single();
      
    if (updateError) {
      error(`Error updating user profile for ${userId}: ${updateError.message}`);
      return null;
    }
    
    return updatedUser;
  } catch (err) {
    error(`Error in updateUserProfile: ${err.message}`);
    return null;
  }
};

/**
 * Get users with matching interests
 * @param {string} userId - User ID to exclude
 * @param {Array} interests - Array of interests to match
 * @param {number} limit - Maximum number of users to return
 * @returns {Promise<Array>} Array of user objects
 */
const getUsersWithMatchingInterests = async (userId, interests, limit = 10) => {
  try {
    if (!interests || !Array.isArray(interests) || interests.length === 0) {
      return [];
    }
    
    // Query for users who have at least one matching interest
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .neq('id', userId) // Exclude the current user
      .filter('interests', 'cs', `{${interests.join(',')}}`) // Contains any of these interests
      .limit(limit);
      
    if (userError) {
      error(`Error finding users with matching interests: ${userError.message}`);
      return [];
    }
    
    return users;
  } catch (err) {
    error(`Error in getUsersWithMatchingInterests: ${err.message}`);
    return [];
  }
};

/**
 * Get recently active users
 * @param {number} daysActive - Number of days to consider "recent"
 * @param {number} limit - Maximum number of users to return
 * @returns {Promise<Array>} Array of user objects
 */
const getRecentlyActiveUsers = async (daysActive = 7, limit = 20) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysActive);
    
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*')
      .gt('last_active', cutoffDate.toISOString())
      .order('last_active', { ascending: false })
      .limit(limit);
      
    if (userError) {
      error(`Error fetching recently active users: ${userError.message}`);
      return [];
    }
    
    return users;
  } catch (err) {
    error(`Error in getRecentlyActiveUsers: ${err.message}`);
    return [];
  }
};

/**
 * Get users who have been inactive since a specific date
 * @param {string} startDate - ISO string representing the start date of inactivity
 * @param {string} endDate - Optional ISO string representing the end date of inactivity range
 * @returns {Promise<Array<Object>>} - Array of inactive user objects
 */
async function getInactiveUsersSince(startDate, endDate = null) {
  try {
    info(`Fetching users inactive since ${startDate}${endDate ? ` until ${endDate}` : ''}`);
    
    let query = supabase
      .from('users')
      .select('*')
      .lt('last_active', startDate);
    
    if (endDate) {
      query = query.gt('last_active', endDate);
    }
    
    const { data, error } = await query;
    
    if (error) {
      error('Error fetching inactive users', { error });
      throw error;
    }
    
    return data;
  } catch (error) {
    error('Error in getInactiveUsersSince', { error });
    return [];
  }
}

/**
 * Get users with a specific notification preference setting
 * @param {string} preferenceKey - The notification preference key
 * @param {boolean} preferenceValue - The value of the preference
 * @returns {Promise<{data: Array<Object>, error: Error}>} - Object with data and error properties
 */
async function getUsersWithNotificationPreference(preferenceKey, preferenceValue) {
  try {
    info(`Fetching users with notification preference ${preferenceKey}=${preferenceValue}`);
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .filter('notification_preferences->>'+preferenceKey, 'eq', preferenceValue.toString());
    
    if (error) {
      error('Error fetching users by notification preference', { error, preferenceKey, preferenceValue });
    }
    
    return { data, error };
  } catch (error) {
    error('Error in getUsersWithNotificationPreference', { error, preferenceKey, preferenceValue });
    return { data: null, error };
  }
}

module.exports = {
  getUserById,
  updateUserOnlineStatus,
  getUserByUsername,
  updateUserProfile,
  getUsersWithMatchingInterests,
  getRecentlyActiveUsers,
  getInactiveUsersSince,
  getUsersWithNotificationPreference
}; 