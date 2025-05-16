const supabase = require('../config/database');
const logger = require('../utils/logger');
const { VALID_REPORT_TYPES } = require('./reportController');

/**
 * Get all reports for admin with filtering and pagination
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAllReports = async (req, res) => {
  try {
    // Check if reports table exists
    const tableExists = await checkReportsTableExists();
    
    if (!tableExists) {
      return res.status(200).json({
        success: true,
        data: {
          reports: [],
          pagination: {
            total: 0,
            page: 1,
            perPage: 10,
            totalPages: 0
          }
        },
        message: 'No reports found (table does not exist)'
      });
    }
    
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 10;
    const status = req.query.status;
    const contentType = req.query.contentType;
    const reportType = req.query.reportType;
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;
    
    // Build the query
    let query = supabase
      .from('reports')
      .select(`
        id,
        content_type,
        content_id,
        report_type,
        comment,
        reporter:reporter_id(id, username, first_name, last_name),
        created_at,
        updated_at,
        status,
        admin_comment,
        resolver:resolved_by(id, username)
      `, { count: 'exact' });
    
    // Apply filters if provided
    if (status) {
      query = query.eq('status', status);
    }
    
    if (contentType) {
      query = query.eq('content_type', contentType);
    }
    
    if (reportType) {
      query = query.eq('report_type', reportType);
    }
    
    if (fromDate) {
      query = query.gte('created_at', new Date(fromDate).toISOString());
    }
    
    if (toDate) {
      const endDate = new Date(toDate);
      endDate.setDate(endDate.getDate() + 1); // Include the end date
      query = query.lt('created_at', endDate.toISOString());
    }
    
    // Add pagination
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    
    query = query
      .order('created_at', { ascending: false })
      .range(from, to);
    
    // Execute query
    const { data, error, count } = await query;
    
    if (error) {
      logger.error('Error fetching reports:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reports'
      });
    }
    
    // Calculate total pages
    const totalPages = Math.ceil(count / perPage);
    
    return res.status(200).json({
      success: true,
      data: {
        reports: data,
        pagination: {
          total: count,
          page,
          perPage,
          totalPages
        }
      }
    });
  } catch (error) {
    logger.error('Error in getAllReports:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching reports'
    });
  }
};

/**
 * Get report details for admin
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getReportDetails = async (req, res) => {
  try {
    const { reportId } = req.params;
    
    // Check if reports table exists
    const tableExists = await checkReportsTableExists();
    
    if (!tableExists) {
      return res.status(404).json({
        success: false,
        message: 'Reports functionality not available'
      });
    }
    
    // Get report details
    const { data, error } = await supabase
      .from('reports')
      .select(`
        id,
        content_type,
        content_id,
        report_type,
        comment,
        reporter:reporter_id(id, username, first_name, last_name, email),
        created_at,
        updated_at,
        status,
        admin_comment,
        resolver:resolved_by(id, username, first_name, last_name)
      `)
      .eq('id', reportId)
      .single();
    
    if (error) {
      logger.error(`Error fetching report ${reportId}:`, error);
      return res.status(error.code === 'PGRST116' ? 404 : 500).json({
        success: false,
        message: error.code === 'PGRST116' ? 'Report not found' : 'Failed to fetch report details'
      });
    }
    
    // Get additional content information based on content type
    let contentDetails = null;
    
    if (data.content_type === 'message') {
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          sender:sender_id(id, username, first_name, last_name),
          receiver:receiver_id(id, username, first_name, last_name),
          created_at
        `)
        .eq('id', data.content_id)
        .single();
      
      if (!messageError && message) {
        contentDetails = message;
      }
    } else if (data.content_type === 'user') {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select(`
          id,
          username,
          first_name,
          last_name,
          email,
          bio,
          created_at
        `)
        .eq('id', data.content_id)
        .single();
      
      if (!userError && user) {
        contentDetails = user;
      }
    } else if (data.content_type === 'post') {
      const { data: post, error: postError } = await supabase
        .from('posts')
        .select(`
          id,
          content,
          author:user_id(id, username, first_name, last_name),
          created_at
        `)
        .eq('id', data.content_id)
        .single();
      
      if (!postError && post) {
        contentDetails = post;
      }
    }
    
    return res.status(200).json({
      success: true,
      data: {
        report: data,
        contentDetails
      }
    });
  } catch (error) {
    logger.error('Error in getReportDetails:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching report details'
    });
  }
};

/**
 * Update report status for admin
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const updateReportStatus = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, adminComment } = req.body;
    
    // Check if reports table exists
    const tableExists = await checkReportsTableExists();
    
    if (!tableExists) {
      return res.status(404).json({
        success: false,
        message: 'Reports functionality not available'
      });
    }
    
    // Validate status
    const validStatuses = ['pending', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    
    // Update report
    const { data, error } = await supabase
      .from('reports')
      .update({
        status,
        admin_comment: adminComment || null,
        resolved_by: status !== 'pending' ? req.user.id : null,
        updated_at: new Date()
      })
      .eq('id', reportId)
      .select()
      .single();
    
    if (error) {
      logger.error(`Error updating report ${reportId}:`, error);
      return res.status(error.code === 'PGRST116' ? 404 : 500).json({
        success: false,
        message: error.code === 'PGRST116' ? 'Report not found' : 'Failed to update report'
      });
    }
    
    logger.info(`Report ${reportId} status updated to ${status} by admin ${req.user.id}`);
    
    return res.status(200).json({
      success: true,
      message: 'Report updated successfully',
      data: {
        report: data
      }
    });
  } catch (error) {
    logger.error('Error in updateReportStatus:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating report'
    });
  }
};

/**
 * Check if reports table exists in the database
 * @returns {Promise<boolean>} True if table exists
 */
const checkReportsTableExists = async () => {
  try {
    // Check if table exists using system tables query
    const { data, error } = await supabase
      .rpc('check_table_exists', { table_name: 'reports' });
    
    if (error) {
      // If RPC function doesn't exist, try direct table query (will return error if table doesn't exist)
      try {
        await supabase.from('reports').select('id').limit(1);
        return true;
      } catch (directError) {
        return false;
      }
    }
    
    return data;
  } catch (error) {
    logger.error('Error checking if reports table exists:', error);
    return false;
  }
};

module.exports = {
  getAllReports,
  getReportDetails,
  updateReportStatus
}; 