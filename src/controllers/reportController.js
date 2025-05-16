const supabase = require('../config/database');
const logger = require('../utils/logger');
const axios = require('axios');

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
          const result = await autoModeration.processReportWithAI(reportId);
          
          // Safely log the result without circular references
          const safeResult = {
            success: result.success,
            message: result.message,
            action: result.action
          };
          
          if (result.success) {
            logger.info(`🤖 AI processing result for ${reportId}: Success - ${safeResult.message}`);
          } else {
            logger.error(`🤖 AI processing result for ${reportId}: Failed - ${safeResult.message}`);
            
            // Log error details if available
            if (result.error) {
              logger.error(`Error details for report ${reportId}: ${result.error}`);
            }
          }
        } catch (err) {
          // Safe error handling
          const safeError = {
            message: err.message || 'Unknown error',
            name: err.name || 'UnknownError',
            code: err.code
          };
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
    // Safe error handling
    const safeError = {
      message: error.message || 'Unknown error',
      name: error.name || 'UnknownError',
      code: error.code
    };
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

module.exports = {
  submitReport,
  getUserReports,
  VALID_REPORT_TYPES
}; 