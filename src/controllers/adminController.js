const supabase = require('../config/database');
const { activeMatches, matchmakingPool } = require('../socket/socketManager');

/**
 * Get all users with pagination
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAllUsers = async (req, res) => {
  try {
    // Get pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get filters
    const searchTerm = req.query.search || '';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? true : false;
    
    // Build query
    let query = supabase
      .from('users')
      .select('id, first_name, last_name, username, email, created_at, last_login, is_admin, is_banned', { count: 'exact' });
    
    // Apply search if provided
    if (searchTerm) {
      query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
    }
    
    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder });
    
    // Apply pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data, count, error } = await query;
    
    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get all users with a higher page limit (for admin dashboard)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAllUsersBulk = async (req, res) => {
  try {
    // Get pagination params with higher default limit
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // Default 100 users per page
    const offset = (page - 1) * limit;
    
    // Get filters
    const searchTerm = req.query.search || '';
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? true : false;
    
    // Build query
    let query = supabase
      .from('users')
      .select('id, first_name, last_name, username, email, created_at, last_login, is_admin, is_banned', { count: 'exact' });
    
    // Apply search if provided
    if (searchTerm) {
      query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
    }
    
    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder });
    
    // Apply pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data, count, error } = await query;
    
    if (error) {
      console.error('Error fetching users in bulk:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in getAllUsersBulk:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get user details by ID
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Get user details
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user'
      });
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Remove sensitive data
    delete user.password;
    
    return res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error in getUserById:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Update user's admin status
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateUserAdminStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isAdmin } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    if (isAdmin === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isAdmin field is required'
      });
    }
    
    // Update user's admin status
    const { data, error } = await supabase
      .from('users')
      .update({ is_admin: isAdmin })
      .eq('id', userId)
      .select('id, first_name, last_name, username, is_admin')
      .single();
    
    if (error) {
      console.error('Error updating user admin status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user admin status'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      message: `User ${data.username} admin status updated to ${isAdmin ? 'admin' : 'regular user'}`
    });
  } catch (error) {
    console.error('Error in updateUserAdminStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Ban or unban a user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateUserBanStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isBanned, reason } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    if (isBanned === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isBanned field is required'
      });
    }
    
    // Update user ban status
    const { data, error } = await supabase
      .from('users')
      .update({
        is_banned: isBanned,
        ban_reason: isBanned ? (reason || 'Violated terms of service') : null,
        banned_at: isBanned ? new Date() : null
      })
      .eq('id', userId)
      .select('id, first_name, last_name, username, is_banned')
      .single();
    
    if (error) {
      console.error('Error updating user ban status:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user ban status'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      message: `User ${data.username} has been ${isBanned ? 'banned' : 'unbanned'}`
    });
  } catch (error) {
    console.error('Error in updateUserBanStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get detailed matchmaking statistics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getDetailedMatchmakingStats = async (req, res) => {
  try {
    // Get match stats from database
    const { data: matchStats, error: matchStatsError } = await supabase
      .from('matches')
      .select('status')
      .eq('created_at', '>', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    
    if (matchStatsError) {
      console.error('Error fetching match stats:', matchStatsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch match statistics'
      });
    }
    
    // Calculate match statistics
    const total = matchStats.length;
    const accepted = matchStats.filter(match => match.status === 'accepted').length;
    const rejected = matchStats.filter(match => match.status === 'rejected').length;
    const pending = matchStats.filter(match => match.status === 'pending').length;
    
    // Get current matchmaking queue status
    const queueSize = matchmakingPool.size;
    const activeMatchesCount = activeMatches.size;
    
    // Get the most popular interests
    const { data: interests, error: interestsError } = await supabase
      .from('user_interests')
      .select('interest')
      .limit(1000);
    
    if (interestsError) {
      console.error('Error fetching interests:', interestsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch interests'
      });
    }
    
    // Count occurrences of each interest
    const interestCounts = {};
    interests.forEach(item => {
      if (interestCounts[item.interest]) {
        interestCounts[item.interest]++;
      } else {
        interestCounts[item.interest] = 1;
      }
    });
    
    // Convert to array and sort by count
    const popularInterests = Object.entries(interestCounts)
      .map(([interest, count]) => ({ interest, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return res.status(200).json({
      success: true,
      data: {
        matchStats: {
          total,
          accepted,
          rejected,
          pending,
          successRate: total > 0 ? (accepted / total * 100).toFixed(2) : 0
        },
        currentState: {
          queueSize,
          activeMatches: activeMatchesCount
        },
        popularInterests
      }
    });
  } catch (error) {
    console.error('Error in getDetailedMatchmakingStats:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get server health and performance metrics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getServerHealth = async (req, res) => {
  try {
    const startTime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Get database connection check
    const startTime2 = Date.now();
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    const dbResponseTime = Date.now() - startTime2;
    
    return res.status(200).json({
      success: true,
      data: {
        uptime: startTime,
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
        },
        database: {
          connected: !error,
          responseTime: dbResponseTime + ' ms'
        },
        socket: {
          connectedUsers: req.app.get('connectedUsers')?.size || 0
        }
      }
    });
  } catch (error) {
    console.error('Error in getServerHealth:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get reported content for moderation
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getReportedContent = async (req, res) => {
  try {
    // Get pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Get filters
    const status = req.query.status || 'pending'; // pending, resolved, dismissed
    const reportType = req.query.type || ''; // user, post, message
    
    // Build query
    let query = supabase
      .from('reports')
      .select(`
        id, 
        report_type, 
        reason, 
        details,
        status,
        created_at,
        updated_at,
        reporter:reporter_id(id, username, profile_picture_url),
        reported_user:reported_user_id(id, username, profile_picture_url),
        reported_post:reported_post_id(id, caption, media_url),
        reported_message:reported_message_id(id, content)
      `, { count: 'exact' });
    
    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }
    
    if (reportType) {
      query = query.eq('report_type', reportType);
    }
    
    // Apply sorting and pagination
    query = query.order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    // Execute query
    const { data, count, error } = await query;
    
    if (error) {
      console.error('Error fetching reported content:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reported content'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error in getReportedContent:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Resolve a report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const resolveReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, actionTaken, adminNotes } = req.body;
    
    if (!reportId) {
      return res.status(400).json({
        success: false,
        message: 'Report ID is required'
      });
    }
    
    if (!status || !['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status (resolved or dismissed) is required'
      });
    }
    
    // Update report status
    const { data, error } = await supabase
      .from('reports')
      .update({
        status,
        action_taken: actionTaken || null,
        admin_notes: adminNotes || null,
        updated_at: new Date(),
        resolved_by: req.user.id
      })
      .eq('id', reportId)
      .select()
      .single();
    
    if (error) {
      console.error('Error resolving report:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to resolve report'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      message: `Report has been marked as ${status}`
    });
  } catch (error) {
    console.error('Error in resolveReport:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Delete a post
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { reason } = req.body;
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Post ID is required'
      });
    }
    
    // Get post info before deletion
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('id, user_id, caption')
      .eq('id', postId)
      .single();
    
    if (fetchError) {
      console.error('Error fetching post:', fetchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch post'
      });
    }
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }
    
    // Delete the post
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);
    
    if (deleteError) {
      console.error('Error deleting post:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete post'
      });
    }
    
    // Log the deletion for audit purposes
    await supabase.from('admin_actions').insert({
      admin_id: req.user.id,
      action_type: 'delete_post',
      target_id: postId,
      target_type: 'post',
      reason: reason || 'Violated community guidelines',
      created_at: new Date()
    });
    
    return res.status(200).json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Error in deletePost:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get system settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getSystemSettings = async (req, res) => {
  try {
    // Get all app settings from the database
    const { data: settings, error } = await supabase
      .from('app_settings')
      .select('*');
    
    if (error) {
      console.error('Error fetching system settings:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch system settings'
      });
    }
    
    // Format settings as key-value pairs
    const formattedSettings = {};
    settings.forEach(setting => {
      formattedSettings[setting.key] = setting.value;
    });
    
    return res.status(200).json({
      success: true,
      data: formattedSettings
    });
  } catch (error) {
    console.error('Error in getSystemSettings:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Update system settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateSystemSettings = async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Settings object is required'
      });
    }
    
    const updates = [];
    
    // Prepare batch updates
    for (const [key, value] of Object.entries(settings)) {
      updates.push({
        key,
        value,
        updated_at: new Date(),
        updated_by: req.user.id
      });
    }
    
    // Update settings in database with upsert operation
    const { data, error } = await supabase
      .from('app_settings')
      .upsert(updates, { onConflict: 'key' })
      .select();
    
    if (error) {
      console.error('Error updating system settings:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update system settings'
      });
    }
    
    return res.status(200).json({
      success: true,
      data,
      message: 'System settings updated successfully'
    });
  } catch (error) {
    console.error('Error in updateSystemSettings:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  getAllUsers,
  getAllUsersBulk,
  getUserById,
  updateUserAdminStatus,
  updateUserBanStatus,
  getDetailedMatchmakingStats,
  getServerHealth,
  getReportedContent,
  resolveReport,
  deletePost,
  getSystemSettings,
  updateSystemSettings
}; 