const supabase = require('../config/database');
const logger = require('../utils/logger');
const geminiAI = require('./geminiAI');

/**
 * Check if a user has been reported multiple times
 * @param {string} userId - User ID to check
 * @returns {Promise<Array>} Array of past reports
 */
const getUserReportHistory = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('reported_user_id', userId)
      .order('created_at', { ascending: false });
      
    if (error) {
      logger.error('Error fetching user report history:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error('Error in getUserReportHistory:', error);
    return [];
  }
};

/**
 * Get message content from database
 * @param {string} messageId - Message ID to retrieve
 * @returns {Promise<string|null>} Message content or null if not found
 */
const getMessageContent = async (messageId) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('content, sender_id')
      .eq('id', messageId)
      .single();
      
    if (error || !data) {
      logger.error('Error fetching message content:', error);
      return { content: null, senderId: null };
    }
    
    return { 
      content: data.content,
      senderId: data.sender_id
    };
  } catch (error) {
    logger.error('Error in getMessageContent:', error);
    return { content: null, senderId: null };
  }
};

/**
 * Ban a user based on AI recommendation
 * @param {string} userId - User ID to ban
 * @param {string} reason - Reason for the ban
 * @param {string} duration - Ban duration (PERMANENT, 7_DAYS, 30_DAYS)
 * @returns {Promise<boolean>} Success status
 */
const banUser = async (userId, reason, duration) => {
  try {
    let banUntil = null;
    
    if (duration === '7_DAYS') {
      banUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (duration === '30_DAYS') {
      banUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    
    const { error } = await supabase
      .from('users')
      .update({
        is_banned: true,
        ban_reason: reason,
        banned_at: new Date(),
        ban_until: banUntil
      })
      .eq('id', userId);
      
    if (error) {
      logger.error('Error banning user:', error);
      return false;
    }
    
    logger.info(`User ${userId} banned. Reason: ${reason}, Duration: ${duration}`);
    return true;
  } catch (error) {
    logger.error('Error in banUser:', error);
    return false;
  }
};

/**
 * Process a report automatically using Gemini AI
 * @param {string} reportId - Report ID to process
 * @returns {Promise<Object>} Processing result
 */
const processReportWithAI = async (reportId) => {
  try {
    console.log('🤖 Starting processReportWithAI for report:', reportId);
    
    // Get report details
    const { data: report, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .single();
      
    if (error || !report) {
      console.error('❌ Error fetching report:', error);
      logger.error(`Error fetching report ${reportId}:`, error);
      return {
        success: false,
        message: 'Report not found or error fetching it'
      };
    }
    
    console.log('🤖 Retrieved report:', report.id, 'content_type:', report.content_type);
    
    // Only process message reports
    if (report.content_type !== 'message') {
      console.log('❌ Skipping non-message report');
      return {
        success: false,
        message: 'Auto-moderation only processes message reports'
      };
    }
    
    // Get message content
    console.log('🤖 Fetching message content for:', report.content_id);
    const { content: messageContent, senderId } = await getMessageContent(report.content_id);
    
    if (!messageContent) {
      console.log('❌ Message content not found');
      await updateReportStatus(reportId, 'rejected', 'Message not found in database - auto-rejected by Gemini AI');
      return {
        success: true,
        message: 'Report auto-rejected - message not found',
        action: 'REJECTED'
      };
    }
    
    console.log('🤖 Message content retrieved, analyzing with Gemini AI');
    
    // Analyze message content with Gemini AI
    const contentAnalysis = await geminiAI.analyzeMessageContent(messageContent);
    console.log('🤖 Gemini AI analysis complete:', contentAnalysis.classification);
    
    if (contentAnalysis.classification === 'ACCEPTABLE') {
      // Message is fine, reject the report
      console.log('🤖 Content deemed acceptable, rejecting report');
      await updateReportStatus(reportId, 'rejected', `Auto-rejected by Gemini AI: ${contentAnalysis.explanation}`);
      return {
        success: true,
        message: 'Report auto-rejected - content deemed acceptable',
        action: 'REJECTED',
        analysis: contentAnalysis
      };
    } else if (contentAnalysis.classification === 'BORDERLINE' && contentAnalysis.confidence < 0.7) {
      // Borderline case with low confidence, leave for human review
      console.log('🤖 Borderline content with low confidence, marking for human review');
      await updateReportStatus(reportId, 'pending', `Marked for human review by Gemini AI: ${contentAnalysis.explanation}`);
      return {
        success: true,
        message: 'Report pending human review - borderline content',
        action: 'PENDING_REVIEW',
        analysis: contentAnalysis
      };
    } else {
      // Get user's report history
      console.log('🤖 Content potentially violates guidelines, checking user history');
      const reportHistory = await getUserReportHistory(senderId);
      console.log('🤖 User has', reportHistory.length, 'previous reports');
      
      // Evaluate if user should be banned based on history and current violation
      console.log('🤖 Evaluating user with Gemini AI');
      const userEvaluation = await geminiAI.evaluateUserHistory(reportHistory, contentAnalysis);
      console.log('🤖 User evaluation complete, action:', userEvaluation.action);
      
      if (userEvaluation.action === 'BANNED') {
        // Ban the user
        const banReason = `Banned due to inappropriate content: ${contentAnalysis.explanation}`;
        const banSuccess = await banUser(senderId, banReason, userEvaluation.recommendedBanDuration);
        
        // Update report status
        await updateReportStatus(
          reportId, 
          'resolved', 
          `Auto-resolved by Gemini AI: User banned. ${contentAnalysis.explanation}`
        );
        
        return {
          success: true,
          message: `Report auto-resolved - user banned for ${userEvaluation.recommendedBanDuration}`,
          action: 'USER_BANNED',
          analysis: contentAnalysis,
          evaluation: userEvaluation
        };
      } else if (userEvaluation.action === 'WARNED') {
        // Update report status
        await updateReportStatus(
          reportId, 
          'resolved', 
          `Auto-resolved by Gemini AI: Warning issued. ${contentAnalysis.explanation}`
        );
        
        // TODO: Implement warning notification system
        
        return {
          success: true,
          message: 'Report auto-resolved - user should be warned',
          action: 'USER_WARNED',
          analysis: contentAnalysis,
          evaluation: userEvaluation
        };
      } else {
        // No action needed, but report is valid
        await updateReportStatus(
          reportId, 
          'resolved', 
          `Auto-resolved by Gemini AI: No action needed. ${contentAnalysis.explanation}`
        );
        
        return {
          success: true,
          message: 'Report auto-resolved - no action needed',
          action: 'RESOLVED_NO_ACTION',
          analysis: contentAnalysis,
          evaluation: userEvaluation
        };
      }
    }
  } catch (error) {
    logger.error('Error in processReportWithAI:', error);
    return {
      success: false,
      message: 'Error processing report with AI',
      error: error.message
    };
  }
};

/**
 * Update report status and add to activity log
 * @param {string} reportId - Report ID to update
 * @param {string} status - New status
 * @param {string} comment - Admin comment
 * @returns {Promise<boolean>} Success status
 */
const updateReportStatus = async (reportId, status, comment) => {
  try {
    // Update report status
    const { error } = await supabase
      .from('reports')
      .update({
        status: status,
        admin_comment: comment,
        updated_at: new Date()
      })
      .eq('id', reportId);
      
    if (error) {
      logger.error('Error updating report status:', error);
      return false;
    }
    
    // Add to activity log
    const { error: logError } = await supabase
      .from('admin_activity_log')
      .insert({
        admin_id: null, // Null indicates AI
        action: `report_${status}`,
        details: `Report ${reportId} ${status} by Gemini AI: ${comment}`,
        created_at: new Date(),
        resource_type: 'report',
        resource_id: reportId
      });
      
    if (logError) {
      logger.error('Error logging admin activity:', logError);
    }
    
    return true;
  } catch (error) {
    logger.error('Error in updateReportStatus:', error);
    return false;
  }
};

module.exports = {
  processReportWithAI,
  getUserReportHistory,
  banUser
}; 