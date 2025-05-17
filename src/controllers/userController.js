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

/**
 * Get comprehensive user details including account status, matches, messages, reports
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.id;
    
    console.log('DEBUG - getUserDetails called with params:', { 
      userId,
      requestingUserId,
      isAdmin: req.user.is_admin
    });
    
    // Check if requesting user is an admin or the user themselves
    const isAdminOrSelf = req.user.is_admin || requestingUserId === userId;
    
    if (!userId) {
      console.log('DEBUG - userId is undefined or null');
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // First fetch just the basic user without joins
    console.log('DEBUG - Attempting to fetch user data with ID:', userId);
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    console.log('DEBUG - Query result:', { user, error });

    if (error || !user) {
      console.log('DEBUG - User not found or error occurred:', error);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Add location data separately if needed
    let locationData = null;
    try {
      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('id, country, city, latitude, longitude')
        .eq('user_id', userId)
        .single();
        
      if (!locationError && location) {
        locationData = location;
      }
    } catch (locationErr) {
      console.log('DEBUG - Error fetching location:', locationErr);
      // Just log, don't fail the request
    }
    
    if (locationData) {
      user.location = locationData;
    }
    
    // Remove sensitive data if not admin or self
    if (!isAdminOrSelf) {
      delete user.password;
      delete user.email;
      delete user.phone;
      delete user.date_of_birth;
      delete user.is_banned;
      delete user.ban_reason;
      delete user.notifications_enabled;
    }
    
    // Additional data to fetch if admin or self
    let matchesData = [];
    let messagesData = [];
    let reportsData = { byUser: [], againstUser: [] };
    let accountStatus = {};
    
    if (isAdminOrSelf) {
      // Fetch user's matches
      const { data: matches, error: matchesError } = await supabase
        .from('matches')
        .select('*, user1:user1_id(id, username, profile_picture_url), user2:user2_id(id, username, profile_picture_url)')
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50);
        
      if (!matchesError) {
        matchesData = matches.map(match => {
          const otherUser = match.user1_id === userId ? match.user2 : match.user1;
          return {
            id: match.id,
            status: match.status,
            created_at: match.created_at,
            other_user: otherUser
          };
        });
      }
      
      // Fetch user's recent messages (sent or received)
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('id, content, sender_id, receiver_id, created_at, is_read')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(50);
        
      if (!messagesError) {
        messagesData = messages;
      }
      
      // Fetch reports made by the user
      const { data: reportsByUser, error: reportsByUserError } = await supabase
        .from('reports')
        .select('id, reporter_id, reported_user_id, reason, status, created_at')
        .eq('reporter_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
        
      if (!reportsByUserError) {
        reportsData.byUser = reportsByUser;
      }
      
      // Fetch reports against the user
      const { data: reportsAgainstUser, error: reportsAgainstUserError } = await supabase
        .from('reports')
        .select('id, reporter_id, reported_user_id, reason, status, created_at')
        .eq('reported_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
        
      if (!reportsAgainstUserError) {
        reportsData.againstUser = reportsAgainstUser;
      }
      
      // Calculate account status and abuse metrics
      if (reportsData.againstUser.length > 0) {
        const validReports = reportsData.againstUser.filter(
          report => report.status === 'resolved' || report.status === 'action_taken'
        );
        
        accountStatus = {
          total_reports: reportsData.againstUser.length,
          valid_reports: validReports.length,
          abuse_percentage: reportsData.againstUser.length > 0 
            ? Math.round((validReports.length / reportsData.againstUser.length) * 100) 
            : 0,
          risk_level: determineRiskLevel(validReports.length, reportsData.againstUser.length)
        };
      } else {
        accountStatus = {
          total_reports: 0,
          valid_reports: 0,
          abuse_percentage: 0,
          risk_level: 'LOW'
        };
      }
    }

    // Get user activity data
    const { data: userActivity, error: activityError } = await supabase
      .from('users')
      .select('created_at, last_login, last_active, is_online')
      .eq('id', userId)
      .single();
    
    const activityData = !activityError ? {
      created_at: userActivity.created_at,
      last_login: userActivity.last_login,
      last_active: userActivity.last_active,
      is_online: userActivity.is_online
    } : {};

    return res.status(200).json({
      success: true,
      data: {
        user,
        account_status: isAdminOrSelf ? accountStatus : undefined,
        activity: activityData,
        matches: isAdminOrSelf ? matchesData : undefined,
        messages: isAdminOrSelf ? messagesData : undefined,
        reports: isAdminOrSelf ? reportsData : undefined
      }
    });
  } catch (error) {
    console.error('Get user details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user details'
    });
  }
};

/**
 * Update user details
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.id;
    
    // Check if requesting user is an admin or the user themselves
    const isAdminOrSelf = req.user.is_admin || requestingUserId === userId;
    
    if (!isAdminOrSelf) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this user'
      });
    }
    
    // Extract updatable fields from request body
    const {
      first_name,
      last_name,
      username,
      email,
      phone,
      date_of_birth,
      gender,
      interests,
      preference,
      profile_picture_url,
      bio,
      notifications_enabled
    } = req.body;
    
    // Construct update object with only the fields that were provided
    const updateObj = {};
    
    if (first_name !== undefined) updateObj.first_name = first_name;
    if (last_name !== undefined) updateObj.last_name = last_name;
    if (username !== undefined) updateObj.username = username;
    if (email !== undefined) updateObj.email = email;
    if (phone !== undefined) updateObj.phone = phone;
    if (date_of_birth !== undefined) updateObj.date_of_birth = date_of_birth;
    if (gender !== undefined) updateObj.gender = gender;
    if (interests !== undefined) updateObj.interests = interests;
    if (preference !== undefined) updateObj.preference = preference;
    if (profile_picture_url !== undefined) updateObj.profile_picture_url = profile_picture_url;
    if (bio !== undefined) updateObj.bio = bio;
    if (notifications_enabled !== undefined) updateObj.notifications_enabled = notifications_enabled;
    
    // Check if any fields are being updated
    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }
    
    // Add updated_at timestamp
    updateObj.updated_at = new Date();
    
    // Update user in database
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateObj)
      .eq('id', userId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating user:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }
    
    // Remove sensitive data
    delete updatedUser.password;
    
    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating user'
    });
  }
};

/**
 * Ban or unban a user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const banOrSuspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Only admins can ban/unban users
    if (!req.user.is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can ban or unban users'
      });
    }
    
    const { action, reason } = req.body;
    
    if (!action || !['ban', 'unban'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Valid action (ban or unban) is required'
      });
    }
    
    if (action === 'ban' && !reason) {
      return res.status(400).json({
        success: false, 
        message: 'Reason is required for ban action'
      });
    }
    
    // Prepare update object
    const updateObj = {};
    
    if (action === 'ban') {
      updateObj.is_banned = true;
      updateObj.ban_reason = reason;
      updateObj.banned_at = new Date();
    } else if (action === 'unban') {
      updateObj.is_banned = false;
      updateObj.ban_reason = null;
      updateObj.banned_at = null;
    }
    
    // Update user in database
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateObj)
      .eq('id', userId)
      .select('id, username, is_banned, ban_reason, banned_at')
      .single();
    
    if (error) {
      console.error('Error updating user ban status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user status'
      });
    }
    
    // Create admin activity log
    const adminActionText = action === 'ban' ? 'banned' : 'unbanned';
    const { error: logError } = await supabase
      .from('admin_activities')
      .insert({
        admin_id: req.user.id,
        activity_type: `user_${action}`,
        description: `Admin ${req.user.username} ${adminActionText} user ${updatedUser.username} ${reason ? `for: ${reason}` : ''}`,
        target_id: userId,
        created_at: new Date()
      });
    
    if (logError) {
      console.error('Error logging admin activity:', logError);
      // Don't return error, just log it
    }
    
    return res.status(200).json({
      success: true,
      message: `User ${action === 'ban' ? 'banned' : 'unbanned'} successfully`,
      data: updatedUser
    });
  } catch (error) {
    console.error('Ban user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

/**
 * Helper function to determine risk level based on reports
 * @param {number} validReports - Number of valid reports
 * @param {number} totalReports - Total number of reports
 * @returns {string} Risk level (LOW, MEDIUM, HIGH, CRITICAL)
 */
const determineRiskLevel = (validReports, totalReports) => {
  const percentage = totalReports > 0 ? (validReports / totalReports) * 100 : 0;
  
  if (validReports >= 5 || percentage >= 70) return 'CRITICAL';
  if (validReports >= 3 || percentage >= 50) return 'HIGH';
  if (validReports >= 1 || percentage >= 30) return 'MEDIUM';
  return 'LOW';
};

module.exports = {
  searchUsers,
  getUserProfile,
  getUserDetails,
  updateUserDetails,
  banOrSuspendUser
};