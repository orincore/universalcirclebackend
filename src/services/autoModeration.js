const supabase = require('../config/database');
const { info, error, warn } = require('../utils/logger');
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
  let client;
  try {
    info(`Attempting to connect to database to get message ${messageId}`);
    
    // Log database configuration for debugging
    info('Database host:', process.env.PGHOST || 'default');
    info('Database name:', process.env.PGDATABASE || 'default');
    info('Database port:', process.env.PGPORT || '5432');
    
    // Attempt to get a client from the pool
    client = await pool.connect();
    info(`Connected to database successfully, querying for message ${messageId}`);
    
    const result = await client.query(
      'SELECT content FROM messages WHERE id = $1',
      [messageId]
    );
    
    if (result.rows.length === 0) {
      info(`Message ${messageId} not found in database`);
      return '';
    }
    
    info(`Successfully retrieved content for message ${messageId}`);
    return result.rows[0].content;
  } catch (error) {
    info(`Error fetching message ${messageId} content:`, error);
    
    // For connection errors, add more diagnostic information
    if (error.code === 'ECONNREFUSED') {
      info('Database connection refused. Check database server status and connection details.');
    } else if (error.code === 'ETIMEDOUT') {
      info('Database connection timed out. Check network connectivity and firewall settings.');
    } else if (error.code === 'ENOTFOUND') {
      info('Database host not found. Check hostname and DNS resolution.');
    } else if (error.code === 'ECONNRESET') {
      info('Connection reset by database server. Check server logs for issues.');
    }
    
    return '';
  } finally {
    // Always release the client, but only if it was obtained
    if (client) {
      try {
        client.release();
        info('Database client released successfully');
      } catch (releaseError) {
        info('Error releasing database client:', releaseError);
      }
    }
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
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the message details before deleting
      const messageResult = await client.query(
        'SELECT conversation_id, sender_id FROM messages WHERE id = $1',
        [messageId]
      );
      
      if (messageResult.rows.length === 0) {
        info(`❌ Message ${messageId} not found for deletion`);
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
      info(`✅ Successfully deleted inappropriate message: ${messageId}`);
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      info(`❌ Error deleting inappropriate message: ${error.message}`);
      return false;
    } finally {
      client.release();
    }
  } catch (error) {
    info(`❌ Database connection error during message deletion: ${error.message}`);
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
      reason: report.reason,
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
      
      // Check user history
      const userHistory = await getUserReportHistory(reportData.reported_user_id);
      if (userHistory.length >= 3) {
        // This user has been reported multiple times - consider banning
        await banUser(reportData.reported_user_id);
        return updateReportStatus(
          reportData.id, 
          'RESOLVED', 
          `Auto-resolved by Gemini AI: ${aiDecision.explanation}. User banned due to multiple violations.`,
          GEMINI_AI_USER_ID  // Use UUID instead of string "Gemini AI"
        );
      }
      
      return updateReportStatus(
        reportData.id, 
        'RESOLVED', 
        `Auto-resolved by Gemini AI: ${aiDecision.explanation}`,
        GEMINI_AI_USER_ID  // Use UUID instead of string "Gemini AI"
      );
    } else if (aiDecision.classification === 'ACCEPTABLE' && aiDecision.confidence >= 0.9) {
      // High confidence that this is acceptable content
      return updateReportStatus(
        reportData.id, 
        'REJECTED', 
        `Rejected by Gemini AI: ${aiDecision.explanation}`,
        GEMINI_AI_USER_ID  // Use UUID instead of string "Gemini AI"
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
 * @param {string} resolvedBy - Who resolved the report (optional)
 * @returns {Promise<Object>} Updated report
 */
const updateReportStatus = async (reportId, status, adminComment, resolvedBy = null) => {
  try {
    const updateData = {
      status: status,
      admin_comment: adminComment,
      updated_at: new Date().toISOString()
    };
    
    // Only set resolved_by if provided
    if (resolvedBy) {
      updateData.resolved_by = resolvedBy;
    }
    
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