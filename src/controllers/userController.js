const supabase = require('../config/database');

/**
 * Search for users by name or username
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const searchUsers = async (req, res) => {
  try {
    const { query, limit = 20, offset = 0 } = req.query;
    const currentUserId = req.user.id;
    
    if (!query || query.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 3 characters'
      });
    }

    // Search by first name, last name, or username
    const { data: users, error, count } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, profile_picture_url, interests, preference', { count: 'exact' })
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,username.ilike.%${query}%`)
      .neq('id', currentUserId) // Exclude current user
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)
      .order('username', { ascending: true });

    if (error) {
      console.error('Error searching users:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to search users'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: count > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('User search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during user search'
    });
  }
};

/**
 * Get user profile by ID
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Fetch user data
    const { data: user, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, profile_picture_url, interests, preference, gender')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user profile'
    });
  }
};

module.exports = {
  searchUsers,
  getUserProfile
}; 