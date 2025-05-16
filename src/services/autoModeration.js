const supabase = require('../config/database');
const logger = require('../utils/logger');
const geminiAI = require('./geminiAI');
const { pool } = require('../database/dbConfig');

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
 * Delete inappropriate message from database
 * @param {string} messageId - Message ID to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteInappropriateMessage = async (messageId) => {
  try {
    logger.info(`🤖 Attempting to delete inappropriate message: ${messageId}`);
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the message details before deleting
      const messageResult = await client.query(
        'SELECT conversation_id, sender_id FROM messages WHERE id = $1',
        [messageId]
      );
      
      if (messageResult.rows.length === 0) {
        logger.warn(`❌ Message ${messageId} not found for deletion`);
        await client.query('ROLLBACK');
        return false;
      }
      
      const { conversation_id, sender_id } = messageResult.rows[0];
      
      // Delete the message
      await client.query(
        'DELETE FROM messages WHERE id = $1',
        [messageId]
      );
      
      // Create a system message explaining the deletion
      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, content, is_system_message, created_at) 
         VALUES (uuid_generate_v4(), $1, $2, $3, TRUE, NOW())`,
        [
          conversation_id, 
          GEMINI_AI_USER_ID,
          '⚠️ A message was removed by our automated content moderation system for violating community guidelines.'
        ]
      );
      
      // Log the action to admin activity log
      await client.query(
        `INSERT INTO admin_activity_log (admin_id, action_type, target_type, target_id, details, created_at)
         VALUES ($1, 'delete_message', 'message', $2, $3, NOW())`,
        [
          GEMINI_AI_USER_ID,
          messageId,
          JSON.stringify({
            reason: 'Automated removal of inappropriate content',
            conversation_id,
            user_id: sender_id
          })
        ]
      );
      
      await client.query('COMMIT');
      logger.info(`✅ Successfully deleted inappropriate message: ${messageId}`);
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`❌ Error deleting inappropriate message: ${error.message}`);
      return false;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error(`❌ Database connection error during message deletion: ${error.message}`);
    return false;
  }
};

/**
 * Process a report automatically using Gemini AI
 * @param {string} reportId - Report ID to process
 * @returns {Promise<Object>} Processing result
 */
const processReportWithAI = async (report) => {
  try {
    const { message_id, reason, reported_by, reported_user_id } = report;

    logger.info(`🤖 Processing report for message ${message_id} with Gemini AI`);

    // Get the message content
    const client = await pool.connect();
    let messageContent;
    let messageDeleted = false;

    try {
      const result = await client.query(
        'SELECT content FROM messages WHERE id = $1',
        [message_id]
      );

      if (result.rows.length === 0) {
        logger.warn(`❌ Message ${message_id} not found for AI processing`);
        // Update report status to indicate message not found
        await updateReportStatus(report.id, 'resolved', 'Message not found');
        return { ...report, status: 'resolved', resolution_notes: 'Message not found' };
      }

      messageContent = result.rows[0].content;

      // Get reporting user's previous reports
      const previousReportsResult = await client.query(
        `SELECT COUNT(*) as total_reports, 
         SUM(CASE WHEN status = 'resolved' AND resolution_notes LIKE '%confirmed inappropriate%' THEN 1 ELSE 0 END) as confirmed_reports
         FROM reports WHERE reported_by = $1`,
        [reported_by]
      );

      const userReportHistory = previousReportsResult.rows[0];
      
      // Get reported user's previous violations
      const userViolationsResult = await client.query(
        `SELECT COUNT(*) as total_violations
         FROM reports 
         WHERE reported_user_id = $1 
         AND status = 'resolved' 
         AND resolution_notes LIKE '%confirmed inappropriate%'`,
        [reported_user_id]
      );
      
      const userViolationHistory = userViolationsResult.rows[0];
      
      // Analyze the message
      const analysis = await geminiAI.analyzeMessageContent(messageContent);
      logger.info(`🤖 AI Analysis: ${analysis.classification}, Confidence: ${analysis.confidence}`);

      let status = 'pending';
      let resolutionNotes = '';
      let actionTaken = 'None';

      // Determine actions based on analysis
      if (analysis.classification === 'INAPPROPRIATE' && analysis.confidence >= 0.7) {
        // High confidence inappropriate content - delete message and resolve report
        messageDeleted = await deleteInappropriateMessage(message_id);
        status = 'resolved';
        actionTaken = messageDeleted ? 'Message deleted' : 'Failed to delete message';
        resolutionNotes = `AI confirmed inappropriate content (${analysis.confidence.toFixed(2)} confidence). ${actionTaken}. Violated: ${analysis.violatedPolicies.join(', ')}`;
        
        // Check if user should be reviewed for ban based on violation history
        if (userViolationHistory.total_violations >= 2) {
          resolutionNotes += ` ⚠️ User has ${userViolationHistory.total_violations + 1} confirmed violations - account review recommended.`;
        }
      } 
      else if ((analysis.classification === 'INAPPROPRIATE' && analysis.confidence >= 0.5) || 
              (analysis.classification === 'BORDERLINE' && analysis.confidence >= 0.8)) {
        // Moderate confidence inappropriate or high confidence borderline - flag for human review
        status = 'pending';
        resolutionNotes = `AI suggests review (${analysis.confidence.toFixed(2)} confidence). Possible issues: ${analysis.explanation}`;
      } 
      else {
        // Content seems acceptable - resolve report
        status = 'resolved';
        resolutionNotes = `AI found no violations (${analysis.confidence.toFixed(2)} confidence). Message appears to comply with guidelines.`;
        
        // Check if reporting user has a history of false reports
        if (userReportHistory.total_reports > 5 && userReportHistory.confirmed_reports / userReportHistory.total_reports < 0.2) {
          resolutionNotes += ` Note: Reporting user has low accuracy rate (${userReportHistory.confirmed_reports}/${userReportHistory.total_reports} confirmed).`;
        }
      }

      // Update report status
      await updateReportStatus(report.id, status, resolutionNotes);
      
      // Return the updated report
      return { 
        ...report, 
        status, 
        resolution_notes: resolutionNotes, 
        ai_analysis: analysis,
        message_deleted: messageDeleted
      };
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error(`❌ Error processing report with AI: ${error.message}`);
    return { ...report, ai_error: error.message };
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
        updated_at: new Date(),
        resolved_by: status === 'pending' ? null : GEMINI_AI_USER_ID // Set Gemini AI as resolver if not pending
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
        admin_id: GEMINI_AI_USER_ID, // Use Gemini AI ID instead of null
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
  banUser,
  deleteInappropriateMessage
}; 