const supabase = require('../config/database');
const logger = require('../utils/logger');

// Valid report types
const VALID_REPORT_TYPES = [
  'Inappropriate Content',
  'Spam',
  'Harassment',
  'Impersonation',
  'Others'
];

// Map user-friendly report types to database-compatible values
const REPORT_TYPE_MAP = {
  'Inappropriate Content': 'inappropriate',
  'Spam': 'spam',
  'Harassment': 'harassment',
  'Impersonation': 'impersonation',
  'Others': 'other'
};

// Valid content types
const VALID_CONTENT_TYPES = [
  'message',
  'user',
  'post'
];

/**
 * Submit a new report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const submitReport = async (req, res) => {
  try {
    // Validate request body
    const { 
      contentType, 
      contentId, 
      reportType, 
      comment 
    } = req.body;
    
    // Basic validation
    if (!contentType || !contentId || !reportType) {
      return res.status(400).json({
        success: false,
        message: 'Content type, content ID, and report type are required'
      });
    }
    
    // Validate report type
    if (!VALID_REPORT_TYPES.includes(reportType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid report type. Must be one of: ${VALID_REPORT_TYPES.join(', ')}`
      });
    }
    
    // Validate content type
    if (!VALID_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid content type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`
      });
    }
    
    // Check if content exists based on content type
    let contentExists = false;
    
    if (contentType === 'message') {
      const { data, error } = await supabase
        .from('messages')
        .select('id')
        .eq('id', contentId)
        .single();
        
      contentExists = !error && data;
    } else if (contentType === 'user') {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('id', contentId)
        .single();
        
      contentExists = !error && data;
    } else if (contentType === 'post') {
      const { data, error } = await supabase
        .from('posts')
        .select('id')
        .eq('id', contentId)
        .single();
        
      contentExists = !error && data;
    }
    
    if (!contentExists) {
      return res.status(404).json({
        success: false,
        message: `${contentType} with ID ${contentId} not found`
      });
    }
    
    // Ensure reports table exists
    await ensureReportsTableExists();
    
    // Prepare the report data with proper field mappings
    const reportData = {
      // Primary data from request
      report_type: reportType,        // Use raw value without mapping
      reason: reportType,             // Store original report type as reason
      comment: comment || null,       // Store comment if provided
      reporter_id: req.user.id,       // User making the report
      content_type: contentType,      // Type of content being reported
      content_id: contentId,          // ID of the content being reported
      
      // Status information
      status: 'pending',              // Initial status
      
      // Timestamps
      created_at: new Date(),         // Creation time
      updated_at: null,               // No updates yet
      
      // Admin related fields (initially null)
      action_taken: null,
      admin_notes: null,
      resolved_by: null,
      admin_comment: null,
      
      // Additional details
      details: null
    };
    
    // Set the appropriate reported ID field based on content type
    if (contentType === 'user') {
      // When reporting a user, store the user's ID in reported_user_id
      reportData.reported_user_id = contentId;
      reportData.reported_post_id = null;
    } else if (contentType === 'message' || contentType === 'post') {
      // When reporting a message or post, store the content ID in reported_post_id
      reportData.reported_post_id = contentId;
      reportData.reported_user_id = null;
    } else {
      // For other content types, both fields should be null
      reportData.reported_user_id = null;
      reportData.reported_post_id = null;
    }
    
    // Create the report
    const { data: report, error } = await supabase
      .from('reports')
      .insert(reportData)
      .select()
      .single();
      
    if (error) {
      logger.error('Error creating report:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create report'
      });
    }
    
    logger.info(`New report submitted: ${reportType} for ${contentType} ${contentId} by user ${req.user.id}`);
    
    return res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      data: {
        reportId: report.id
      }
    });
  } catch (error) {
    logger.error('Error in submitReport:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting report'
    });
  }
};

/**
 * Get user's reports
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserReports = async (req, res) => {
  try {
    // Check if reports table exists
    const tableExists = await checkReportsTableExists();
    
    if (!tableExists) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No reports found'
      });
    }
    
    // Get user's reports
    const { data, error } = await supabase
      .from('reports')
      .select(`
        id,
        content_type,
        content_id,
        report_type,
        comment,
        created_at,
        status
      `)
      .eq('reporter_id', req.user.id)
      .order('created_at', { ascending: false });
      
    if (error) {
      logger.error('Error fetching user reports:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user reports'
      });
    }
    
    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error in getUserReports:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user reports'
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

/**
 * Ensure reports table exists in the database
 */
const ensureReportsTableExists = async () => {
  try {
    const tableExists = await checkReportsTableExists();
    
    if (!tableExists) {
      // Create reports table using raw SQL through RPC
      const { error } = await supabase.rpc('create_reports_table');
      
      if (error) {
        logger.error('Error creating reports table:', error);
        throw new Error('Failed to create reports table');
      }
      
      logger.info('Reports table created successfully');
    }
  } catch (error) {
    logger.error('Error ensuring reports table exists:', error);
    throw error;
  }
};

module.exports = {
  submitReport,
  getUserReports,
  VALID_REPORT_TYPES
}; 