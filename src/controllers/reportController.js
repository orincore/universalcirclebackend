const supabase = require('../config/database');
const logger = require('../utils/logger');
const axios = require('axios');
const geminiAI = require('../services/geminiAI');

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
    } else if (contentType === 'message') {
      // For messages, we should NOT set reported_post_id as it has a foreign key to posts table
      // Instead, we'll just use content_type and content_id to identify the message
      reportData.reported_post_id = null;
      reportData.reported_user_id = null;
      
      // Add additional check to see if the message exists
      const { data: messageExists, error: messageError } = await supabase
        .from('messages')
        .select('id')
        .eq('id', contentId)
        .single();
        
      if (messageError || !messageExists) {
        logger.error(`Message with ID ${contentId} not found:`, messageError);
        return res.status(404).json({
          success: false,
          message: `Message with ID ${contentId} not found`
        });
      }
      
      logger.info(`Reporting message: ${contentId}`);
    } else if (contentType === 'post') {
      // When reporting a post, store the content ID in reported_post_id
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
      logger.error('Error creating report with ORM:', error);
      
      // Log detailed error information
      console.error('Error details:', {
        error,
        reportData,
        code: error.code,
        message: error.message,
        details: error.details
      });
      
      return res.status(500).json({
        success: false,
        message: 'Failed to create report',
        details: error.message
      });
    }
    
    logger.info(`New report submitted: ${reportType} for ${contentType} ${contentId} by user ${req.user.id}`);
    
    // If this is a message report, trigger Gemini AI processing
    if (contentType === 'message' && process.env.AI_MODERATION_ENABLED === 'true') {
      try {
        // Add debug logging
        console.log('🤖 AI_MODERATION_ENABLED is set to:', process.env.AI_MODERATION_ENABLED);
        console.log('🤖 Triggering AI processing for report:', report.id);
        console.log('🤖 Processing mode:', process.env.AI_PROCESSING_MODE || 'not set');
        
        // Trigger webhook for AI processing asynchronously
        triggerAIProcessing(report.id);
      } catch (webhookError) {
        logger.error('Error triggering AI processing:', webhookError);
        // We don't fail the request if AI processing fails to trigger
      }
    } else {
      // Add debug logging for when AI processing is skipped
      console.log('❌ AI processing skipped. contentType:', contentType);
      console.log('❌ AI_MODERATION_ENABLED:', process.env.AI_MODERATION_ENABLED);
    }
    
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
 * Trigger AI processing for a report
 * @param {string} reportId - Report ID to process
 */
const triggerAIProcessing = async (reportId) => {
  try {
    logger.info(`🤖 Inside triggerAIProcessing for report: ${reportId}`);
    
    // Check if we should process in-process or via webhook
    if (process.env.AI_PROCESSING_MODE === 'webhook') {
      logger.info('🤖 Using webhook mode for AI processing');
      // Call webhook endpoint to trigger processing
      await axios.post(
        `${process.env.WEBHOOK_BASE_URL}/webhooks/report-processing`, 
        { reportId },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'x-webhook-secret': process.env.WEBHOOK_SECRET 
          } 
        }
      );
      logger.info('🤖 Webhook request sent successfully');
    } else {
      logger.info('🤖 Using direct mode for AI processing');
      // Process directly in the same process (less reliable but simpler)
      const autoModeration = require('../services/autoModeration');
      
      logger.info('🤖 Starting auto-moderation process');
      // Run in the next tick to avoid blocking
      setTimeout(async () => {
        try {
          logger.info(`🤖 Processing report asynchronously: ${reportId}`);
          
          // First get the complete report data
          const { data: report, error: reportError } = await supabase
            .from('reports')
            .select('id, content_id, reporter_id, reported_user_id, reason, status, content_type, comment, admin_comment, resolved_by, updated_at')
            .eq('id', reportId)
            .single();
          
          if (reportError || !report) {
            logger.error(`❌ Error retrieving report data for ${reportId}: ${reportError?.message || 'Report not found'}`);
            return;
          }
          
          // Use content_id as message_id when content_type is 'message' 
          if (report.content_type === 'message') {
            report.message_id = report.content_id;
            report.reported_by = report.reporter_id; // Map to the expected property name
            
            logger.info(`🤖 Retrieved report data for processing: ${reportId}, message_id: ${report.content_id}`);
          } else {
            logger.info(`🤖 Retrieved report data for processing: ${reportId}, content_type: ${report.content_type}`);
          }
          
          // Process the report with the complete data
          const result = await autoModeration.processReportWithAI(report);
          
          // Safely log the result without circular references
          if (result) {
            const safeResult = {
              success: !result.ai_error,
              message: result.resolution_notes || result.ai_error || 'Unknown result',
              status: result.status
            };
            
            if (safeResult.success) {
              logger.info(`🤖 AI processing result for ${reportId}: Success - ${safeResult.message}`);
            } else {
              logger.error(`🤖 AI processing result for ${reportId}: Failed - ${safeResult.message}`);
            }
          } else {
            logger.error(`❌ No result returned for report ${reportId}`);
          }
        } catch (err) {
          // Use shared safe error handling
          const safeError = geminiAI.getSafeErrorDetails(err);
          logger.error(`Error in local AI processing for report ${reportId}: ${safeError.name} - ${safeError.message}`);
          
          // Add stack trace for debugging if available
          if (err.stack) {
            const stackSummary = err.stack.split('\n').slice(0, 3).join('\n');
            logger.error(`Stack trace: ${stackSummary}`);
          }
        }
      }, 0);
      logger.info('🤖 Auto-moderation scheduled');
    }
  } catch (error) {
    // Use shared safe error handling
    const safeError = geminiAI.getSafeErrorDetails(error);
    logger.error(`Error triggering AI processing for report ${reportId}: ${safeError.name} - ${safeError.message}`);
    
    // Don't throw error to prevent request failure
    // Instead return false to indicate failure
    return false;
  }
  
  return true; // Indicate success
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

/**
 * Ensure the create_report function exists
 */
const ensureCreateReportFunctionExists = async () => {
  try {
    // Check if function exists by trying to call it with NULL parameters
    const { error } = await supabase.rpc('create_report', {
      p_content_type: null,
      p_content_id: null,
      p_report_type: null,
      p_reason: null,
      p_comment: null,
      p_reporter_id: null,
      p_reported_user_id: null,
      p_reported_post_id: null
    });
    
    // If no "function does not exist" error, then it exists
    if (!error || !error.message.includes('function does not exist')) {
      return;
    }
    
    // Function doesn't exist, create it
    logger.info('Creating create_report function');
    
    // Read SQL file with function definition
    const fs = require('fs');
    const path = require('path');
    const sqlPath = path.join(__dirname, '../database/createReportFunction.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute SQL to create function
    const { error: createError } = await supabase.rpc('exec_sql', { sql: sql });
    
    if (createError) {
      logger.error('Error creating create_report function:', createError);
      throw new Error('Failed to create create_report function');
    }
    
    logger.info('create_report function created successfully');
  } catch (error) {
    logger.error('Error ensuring create_report function exists:', error);
    // Don't throw, let it fail later if needed
  }
};

/**
 * Get detailed report analytics for a user
 * Including who reported them, message reports, resolution details, and report rate
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserReportAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.id;
    
    // Only admins or the user themselves can access this data
    const isAdminOrSelf = req.user.is_admin || requestingUserId === userId;
    
    if (!isAdminOrSelf) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this information'
      });
    }
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Check if user exists
    const { data: userExists, error: userError } = await supabase
      .from('users')
      .select('id, username, first_name, last_name')
      .eq('id', userId)
      .single();
      
    if (userError || !userExists) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Fetch reports against this user
    const { data: reportsAgainstUser, error: reportsError } = await supabase
      .from('reports')
      .select(`
        id, 
        reason, 
        comment, 
        status, 
        created_at, 
        updated_at,
        action_taken,
        admin_notes,
        admin_comment,
        reporter:reporter_id(id, username, first_name, last_name),
        resolver:resolved_by(id, username, first_name, last_name),
        content_type,
        content_id
      `)
      .eq('reported_user_id', userId)
      .order('created_at', { ascending: false });
      
    if (reportsError) {
      logger.error('Error fetching reports against user:', reportsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reports against user'
      });
    }
    
    // Fetch message reports related to this user's messages
    const { data: userMessages, error: messagesError } = await supabase
      .from('messages')
      .select('id')
      .eq('sender_id', userId);
      
    if (messagesError) {
      logger.error('Error fetching user messages:', messagesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user messages'
      });
    }
    
    // If user has messages, fetch reports for those messages
    let messageReports = [];
    if (userMessages && userMessages.length > 0) {
      const messageIds = userMessages.map(msg => msg.id);
      
      // Fetch reports for these messages
      const { data: reports, error: msgReportsError } = await supabase
        .from('reports')
        .select(`
          id, 
          reason, 
          comment, 
          status, 
          created_at, 
          updated_at,
          action_taken,
          admin_notes,
          admin_comment,
          reporter:reporter_id(id, username, first_name, last_name),
          resolver:resolved_by(id, username, first_name, last_name),
          content_id
        `)
        .eq('content_type', 'message')
        .in('content_id', messageIds)
        .order('created_at', { ascending: false });
        
      if (msgReportsError) {
        logger.error('Error fetching message reports:', msgReportsError);
      } else {
        // For each message report, fetch the actual message content
        const messageReportsWithContent = await Promise.all(
          reports.map(async (report) => {
            const { data: message, error: msgError } = await supabase
              .from('messages')
              .select('id, content, created_at')
              .eq('id', report.content_id)
              .single();
              
            return {
              ...report,
              message: !msgError ? message : { id: report.content_id, content: 'Message not found' }
            };
          })
        );
        
        messageReports = messageReportsWithContent;
      }
    }
    
    // Calculate report statistics
    // Total reports against user
    const totalDirectReports = reportsAgainstUser.length;
    const totalMessageReports = messageReports.length;
    const totalReports = totalDirectReports + totalMessageReports;
    
    // Reports by status
    const resolvedDirectReports = reportsAgainstUser.filter(r => 
      r.status === 'resolved' || r.status === 'RESOLVED' || r.status === 'action_taken' || r.status === 'ACTION_TAKEN'
    ).length;
    
    const resolvedMessageReports = messageReports.filter(r => 
      r.status === 'resolved' || r.status === 'RESOLVED' || r.status === 'action_taken' || r.status === 'ACTION_TAKEN'
    ).length;
    
    const totalResolvedReports = resolvedDirectReports + resolvedMessageReports;
    
    // Calculate report rate - percentage of reports that were valid/resolved
    const reportRate = totalReports > 0 ? (totalResolvedReports / totalReports) * 100 : 0;
    
    // Calculate risk level
    let riskLevel = 'LOW';
    if (totalResolvedReports >= 5 || reportRate >= 70) {
      riskLevel = 'CRITICAL';
    } else if (totalResolvedReports >= 3 || reportRate >= 50) {
      riskLevel = 'HIGH';
    } else if (totalResolvedReports >= 1 || reportRate >= 30) {
      riskLevel = 'MEDIUM';
    }
    
    // Get reports by user (reports made by this user)
    const { data: reportsByUser, error: reportsByUserError } = await supabase
      .from('reports')
      .select(`
        id, 
        reason, 
        comment, 
        status, 
        created_at, 
        content_type,
        content_id,
        reported_user_id,
        reported_user:reported_user_id(id, username, first_name, last_name)
      `)
      .eq('reporter_id', userId)
      .order('created_at', { ascending: false });
      
    if (reportsByUserError) {
      logger.error('Error fetching reports by user:', reportsByUserError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reports by user'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        user: userExists,
        statistics: {
          total_reports: totalReports,
          direct_reports: totalDirectReports,
          message_reports: totalMessageReports,
          resolved_reports: totalResolvedReports,
          report_rate: Math.round(reportRate),
          risk_level: riskLevel
        },
        reports_against_user: reportsAgainstUser,
        message_reports: messageReports,
        reports_by_user: reportsByUser
      }
    });
  } catch (error) {
    logger.error('Error in getUserReportAnalytics:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user report analytics'
    });
  }
};

module.exports = {
  submitReport,
  getUserReports,
  getUserReportAnalytics,
  VALID_REPORT_TYPES
}; 