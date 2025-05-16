const supabase = require('../config/database');
const { info, error, warn } = require('../utils/logger');
const geminiAI = require('./geminiAI');
const crypto = require('crypto');

// Use a fixed UUID for Gemini AI in the database
const GEMINI_AI_USER_ID = '00000000-0000-4000-a000-000000000001'; // Special UUID for Gemini AI

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
      info('Error fetching user report history:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    info('Error in getUserReportHistory:', error);
    return [];
  }
};

/**
 * Get message content from database
 * @param {string} messageId - ID of the message to retrieve
 * @returns {Promise<string>} Message content or empty string if not found
 */
const getMessageContent = async (messageId) => {
  try {
    info(`Attempting to retrieve message ${messageId} using Supabase`);
    
    // Use Supabase client instead of direct PostgreSQL connection
    const { data, error } = await supabase
      .from('messages')
      .select('content')
      .eq('id', messageId)
      .single();
    
    if (error) {
      info(`Error retrieving message ${messageId} with Supabase:`, error);
      return '';
    }
    
    if (!data) {
      info(`Message ${messageId} not found in database`);
      return '';
    }
    
    info(`Successfully retrieved content for message ${messageId}`);
    return data.content;
  } catch (error) {
    info(`Error in getMessageContent for message ${messageId}:`, error);
    return '';
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
      info('Error banning user:', error);
      return false;
    }
    
    info(`User ${userId} banned. Reason: ${reason}, Duration: ${duration}`);
    return true;
  } catch (error) {
    info('Error in banUser:', error);
    return false;
  }
};

/**
 * Delete inappropriate message from database
 * @param {string} messageId - Message ID to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteInappropriateMessage = async (messageId) => {
  try {
    info(`🤖 Attempting to delete inappropriate message: ${messageId}`);
    
    // Delete the message directly without trying to access conversation_id
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);
    
    if (deleteError) {
      info(`❌ Error deleting message ${messageId}: ${deleteError.message}`);
      return false;
    }
    
    // Log the action to admin activity log if it exists
    try {
      const { error: logError } = await supabase
        .from('admin_activity_log')
        .insert({
          admin_id: GEMINI_AI_USER_ID,
          action: 'delete_message',
          target_type: 'message',
          target_id: messageId,
          details: JSON.stringify({
            reason: 'Automated removal of inappropriate content by Gemini AI'
          }),
          created_at: new Date().toISOString()
        });
      
      if (logError) {
        info(`❌ Error logging admin activity: ${logError.message}`);
        // Continue even if logging fails
      }
    } catch (logError) {
      // If the admin_activity_log table doesn't exist, just continue
      info(`❌ Could not log to admin_activity_log: ${logError.message}`);
    }
    
    info(`✅ Successfully deleted inappropriate message: ${messageId}`);
    return true;
  } catch (error) {
    info(`❌ Error in deleteInappropriateMessage: ${error.message}`);
    return false;
  }
};

/**
 * Process a user report using the Gemini AI
 * @param {Object} report - Report object from database
 * @returns {Promise<Object>} Updated report status
 */
const processReportWithAI = async (report) => {
  try {
    // Map the report fields to the correct column names
    const reportData = {
      id: report.id,
      reporter_id: report.reporter_id, // Use reporter_id instead of reported_by
      reported_user_id: report.reported_user_id,
      reason: report.reason || 'No reason provided',
      status: report.status,
      content_type: report.content_type,
      content_id: report.content_id,
      comment: report.comment
    };

    // Get the message content if this is a message report
    let messageContent = '';
    if (reportData.content_type === 'message' && reportData.content_id) {
      messageContent = await getMessageContent(reportData.content_id);
    }

    // Construct prompt for AI
    const prompt = `
      You are a content moderator for a messaging app. You need to evaluate if the following message violates our community guidelines.
      
      Message: "${messageContent}"
      
      User Report Reason: "${reportData.reason}"
      
      Based on this information, classify this message as one of the following:
      - INAPPROPRIATE (clear violation that should be removed)
      - BORDERLINE (potentially problematic but not clear violation)
      - ACCEPTABLE (no violation, false report)
      
      Also rate your confidence level from 0.0 to 1.0.
      Return your response in the following JSON format only:
      {
        "classification": "CLASSIFICATION",
        "confidence": CONFIDENCE_SCORE,
        "explanation": "Brief explanation of your decision"
      }
    `;

    // Process with Gemini AI
    const response = await geminiAI.generateContent(prompt);
    const responseText = response.text().trim();
    
    let aiDecision;
    try {
      // Extract JSON from the AI's response
      const jsonStr = responseText.replace(/```json|```/g, '').trim();
      aiDecision = JSON.parse(jsonStr);
    } catch (error) {
      info('Error parsing AI response:', error);
      return updateReportStatus(reportData.id, 'PENDING_REVIEW', 'Error processing with AI');
    }

    // Logic based on AI decision
    if (aiDecision.classification === 'INAPPROPRIATE' && aiDecision.confidence >= 0.85) {
      // High confidence inappropriate content - take action automatically
      if (reportData.content_type === 'message' && reportData.content_id) {
        await deleteInappropriateMessage(reportData.content_id);
      }
      
      // Check user history - only if we have a valid reported_user_id
      if (reportData.reported_user_id) {
        const userHistory = await getUserReportHistory(reportData.reported_user_id);
        if (userHistory.length >= 3) {
          // This user has been reported multiple times - consider banning
          await banUser(reportData.reported_user_id);
          return updateReportStatus(
            reportData.id, 
            'RESOLVED', 
            `Auto-resolved by Gemini AI: ${aiDecision.explanation}. User banned due to multiple violations.`,
            GEMINI_AI_USER_ID
          );
        }
      }
      
      return updateReportStatus(
        reportData.id, 
        'RESOLVED', 
        `Auto-resolved by Gemini AI: ${aiDecision.explanation}`,
        GEMINI_AI_USER_ID
      );
    } else if (aiDecision.classification === 'ACCEPTABLE' && aiDecision.confidence >= 0.9) {
      // High confidence that this is acceptable content
      return updateReportStatus(
        reportData.id, 
        'REJECTED', 
        `Rejected by Gemini AI: ${aiDecision.explanation}`,
        GEMINI_AI_USER_ID
      );
    } else {
      // Borderline cases or lower confidence - mark for human review
      return updateReportStatus(
        reportData.id, 
        'PENDING_REVIEW', 
        `AI Assessment: ${aiDecision.classification} (${Math.round(aiDecision.confidence * 100)}% confidence). ${aiDecision.explanation}`
      );
    }
  } catch (error) {
    info('Error in processReportWithAI:', error);
    return updateReportStatus(report.id, 'PENDING_REVIEW', `Error during AI processing: ${error.message}`);
  }
};

/**
 * Update a report's status and admin comment
 * @param {string} reportId - Report ID to update
 * @param {string} status - New status value
 * @param {string} adminComment - Admin comment to add
 * @param {string|null} resolvedBy - UUID of user/AI who resolved the report (optional)
 * @returns {Promise<Object>} Updated report
 */
const updateReportStatus = async (reportId, status, adminComment, resolvedBy = null) => {
  try {
    // Basic data validation
    if (!reportId) {
      info('Error: Missing report ID in updateReportStatus');
      return null;
    }

    // Create the update data object
    const updateData = {
      status: status || 'PENDING_REVIEW',
      admin_comment: adminComment || '',
      updated_at: new Date().toISOString()
    };
    
    // Only set resolved_by if provided and it's a valid UUID
    if (resolvedBy) {
      // Validate UUID format (simple check, not comprehensive)
      if (typeof resolvedBy === 'string' && 
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedBy)) {
        updateData.resolved_by = resolvedBy;
      } else {
        info(`Warning: Invalid UUID format for resolvedBy: ${resolvedBy}`);
        // Don't include resolvedBy if it's invalid
      }
    }
    
    // Execute the update
    const { data, error } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId)
      .select();
      
    if (error) {
      info('Error updating report status:', error);
      return null;
    }
    
    info(`Report ${reportId} updated to status: ${status}`);
    return data[0] || null;
  } catch (error) {
    info('Error in updateReportStatus:', error);
    return null;
  }
};

module.exports = {
  processReportWithAI,
  getUserReportHistory,
  banUser,
  deleteInappropriateMessage
}; 