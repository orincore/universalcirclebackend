const supabase = require('../config/database');
const { activeMatches, matchmakingPool, cleanupUserConnections } = require('../socket/socketManager');
const logger = require('../utils/logger');
const { sendBroadcastNotification } = require('../services/firebase/notificationService');

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
 * Get all users with a higher page limit (for admin dashboard with infinite scrolling)
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
    const lastId = req.query.lastId || null; // For cursor-based pagination
    
    // Build query
    let query = supabase
      .from('users')
      .select('id, first_name, last_name, username, email, created_at, last_login, is_admin, is_banned, profile_picture_url', { count: 'exact' });
    
    // Apply search if provided
    if (searchTerm) {
      query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
    }
    
    // Apply cursor-based pagination if lastId is provided (for infinite scrolling)
    if (lastId && sortBy === 'id') {
      if (sortOrder) {
        query = query.gt('id', lastId); // For ascending order, get IDs greater than lastId
      } else {
        query = query.lt('id', lastId); // For descending order, get IDs less than lastId
      }
    } else if (lastId && sortBy === 'created_at') {
      // Get the created_at value for lastId to use as cursor
      const { data: lastUser } = await supabase
        .from('users')
        .select('created_at')
        .eq('id', lastId)
        .single();
        
      if (lastUser) {
        if (sortOrder) {
          query = query.gt('created_at', lastUser.created_at);
        } else {
          query = query.lt('created_at', lastUser.created_at);
        }
      }
    } else {
      // Apply offset-based pagination as fallback
      query = query.range(offset, offset + limit - 1);
    }
    
    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder });
    
    // Apply limit
    query = query.limit(limit);
    
    // Execute query
    const { data, count, error } = await query;
    
    if (error) {
      console.error('Error fetching users in bulk:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }
    
    // Check if there are more results
    const hasMore = data.length === limit;
    
    // Get the last ID for cursor-based pagination
    const nextCursor = data.length > 0 ? data[data.length - 1].id : null;
    
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
        hasMore,
        nextCursor
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

/**
 * Delete a user and all associated data (admin only)
 * This endpoint uses the standard authentication flow:
 * 1. The authenticate middleware verifies the JWT token
 * 2. The isAdmin middleware ensures the authenticated user has admin privileges
 * 3. The admin's ID is available as req.user.id
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    // Default to soft delete unless hard_delete=true is specified
    const hardDelete = req.query.hard_delete === 'true';
    
    logger.info(`Admin ${adminId} initiated ${hardDelete ? 'hard' : 'soft'} delete for user ${userId}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, first_name, last_name')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      logger.warn(`Admin ${adminId} attempted to delete non-existent user ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Clean up any active socket connections for this user
    try {
      cleanupUserConnections(userId);
      logger.info(`Cleaned up socket connections for user ${userId}`);
    } catch (socketError) {
      logger.warn(`Error cleaning up socket connections for user ${userId}:`, socketError);
      // Continue with deletion even if socket cleanup fails
    }

    // If soft delete, just mark the user as deleted and anonymize their data
    if (!hardDelete) {
      const anonymizedData = {
        username: `deleted_${Date.now()}`,
        email: `deleted_${Date.now()}@deleted.com`,
        first_name: 'Deleted',
        last_name: 'User',
        profile_picture_url: null,
        bio: null,
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: adminId
      };
      
      const { error: updateError } = await supabase
        .from('users')
        .update(anonymizedData)
        .eq('id', userId);
        
      if (updateError) {
        logger.error(`Failed to soft delete user ${userId}:`, updateError);
        return res.status(500).json({
          success: false,
          message: 'Failed to soft delete user',
          details: updateError.message
        });
      }
      
      logger.info(`User ${userId} (${user.username}) successfully soft deleted by admin ${adminId}`);
      
      return res.status(200).json({
        success: true,
        message: 'User successfully soft deleted',
        data: {
          userId,
          username: user.username,
          deletionType: 'soft'
        }
      });
    }
    
    // If we reach here, we're doing a hard delete
    logger.info(`Proceeding with hard delete for user ${userId} (${user.username})`);
    
    // First, delete all messages where user is sender or receiver
    const { error: messagesError } = await supabase
      .from('messages')
      .delete()
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    
    if (messagesError) {
      logger.error(`Error deleting messages for user ${userId}:`, messagesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user messages',
        details: messagesError.message
      });
    }
    
    logger.info(`Deleted all messages for user ${userId}`);

    // Delete user's reactions to messages
    const { error: reactionsError } = await supabase
      .from('message_reactions')
      .delete()
      .eq('user_id', userId);
    
    if (reactionsError) {
      logger.error(`Error deleting message reactions for user ${userId}:`, reactionsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete message reactions',
        details: reactionsError.message
      });
    }
    
    logger.info(`Deleted message reactions for user ${userId}`);

    // Delete matches involving this user
    const { error: matchesError } = await supabase
      .from('matches')
      .delete()
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);
    
    if (matchesError) {
      logger.error(`Error deleting matches for user ${userId}:`, matchesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user matches',
        details: matchesError.message
      });
    }
    
    logger.info(`Deleted matches for user ${userId}`);

    // Delete user's reports (both submitted and received)
    const { error: reportsError } = await supabase
      .from('reports')
      .delete()
      .or(`reporter_id.eq.${userId},reported_user_id.eq.${userId}`);
    
    if (reportsError) {
      logger.error(`Error deleting reports for user ${userId}:`, reportsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user reports',
        details: reportsError.message
      });
    }
    
    logger.info(`Deleted reports for user ${userId}`);

    // Finally, delete the user
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (deleteError) {
      logger.error(`Error permanently deleting user ${userId}:`, deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user',
        details: deleteError.message
      });
    }

    logger.info(`User ${userId} (${user.username}) successfully hard deleted by admin ${adminId}`);
    
    return res.status(200).json({
      success: true,
      message: 'User and associated data successfully deleted',
      data: {
        userId,
        username: user.username,
        deletionType: 'hard'
      }
    });
  } catch (error) {
    logger.error(`Error in deleteUser for userId ${req.params.userId}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting user',
      details: error.message
    });
  }
};

/**
 * Send a broadcast notification to all users (admin only)
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const sendAdminBroadcast = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { title, body, data = {}, senderName } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }
    
    // Add admin info to the notification data
    const notificationData = {
      ...data,
      adminId,
      senderName: senderName || 'Universal Circle Team',
      type: 'admin_broadcast'
    };
    
    const notification = {
      title,
      body
    };
    
    logger.info(`Admin ${adminId} is sending broadcast notification: "${title}"`);
    
    const result = await sendBroadcastNotification(notification, notificationData);
    
    if (!result.success) {
      logger.error(`Failed to send broadcast notification: ${result.error}`);
      return res.status(500).json({
        success: false,
        message: 'Failed to send broadcast notification',
        error: result.error
      });
    }
    
    return res.json({
      success: true,
      message: 'Broadcast notification sent successfully',
      data: {
        usersReached: result.usersReached,
        successCount: result.successCount,
        failureCount: result.failureCount
      }
    });
  } catch (error) {
    logger.error('Error in sendAdminBroadcast:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send broadcast notification',
      error: error.message
    });
  }
};

/**
 * Get all admin broadcast notifications (with pagination)
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAdminBroadcasts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    // Get broadcast notifications with pagination
    const { data, error, count } = await supabase
      .from('admin_notifications')
      .select('*, sent_by:sent_by(id, username, first_name, last_name)', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) {
      logger.error(`Error fetching admin broadcasts: ${error.message}`);
      throw error;
    }
    
    return res.json({
      success: true,
      data,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logger.error('Error in getAdminBroadcasts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch broadcast notifications',
      error: error.message
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
  deletePost,
  getSystemSettings,
  updateSystemSettings,
  deleteUser,
  sendAdminBroadcast,
  getAdminBroadcasts
}; 