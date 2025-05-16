const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../database/dbConfig');
const { info, error, warn } = require('../utils/logger');
const autoModeration = require('../services/autoModeration');
const geminiAI = require('../services/geminiAI');

/**
 * @swagger
 * /api/webhook/test-report-moderation:
 *   post:
 *     summary: Test the automated report moderation system
 *     description: Creates a test report and processes it through Gemini AI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message_id:
 *                 type: string
 *                 description: ID of the message to report
 *               reported_by:
 *                 type: string
 *                 description: ID of the user reporting the message
 *               reported_user_id:
 *                 type: string
 *                 description: ID of the user who sent the message
 *               reason:
 *                 type: string
 *                 description: Reason for the report
 *     responses:
 *       200:
 *         description: Successfully processed the report
 *       400:
 *         description: Invalid input data
 *       500:
 *         description: Server error
 */
router.post('/test-report-moderation', async (req, res) => {
  try {
    const { message_id, reported_by, reported_user_id, reason } = req.body;
    
    if (!message_id || !reported_by || !reported_user_id || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: message_id, reported_by, reported_user_id, reason' 
      });
    }
    
    // Create a test report
    const reportId = uuidv4();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert the report
      await client.query(
        `INSERT INTO reports (id, message_id, reported_by, reported_user_id, reason, status, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [reportId, message_id, reported_by, reported_user_id, reason, 'pending']
      );
      
      await client.query('COMMIT');
      info(`✅ Test report created: ${reportId}`);
      
      // Process the report with AI
      const report = { 
        id: reportId, 
        message_id, 
        reported_by, 
        reported_user_id, 
        reason, 
        status: 'pending' 
      };
      
      const result = await autoModeration.processReportWithAI(report);
      
      return res.status(200).json({
        success: true,
        message: 'Report processed successfully',
        report: result
      });
    } catch (err) {
      await client.query('ROLLBACK');
      error(`❌ Error creating test report: ${err.message}`);
      return res.status(500).json({ 
        success: false, 
        message: `Error creating test report: ${err.message}` 
      });
    } finally {
      client.release();
    }
  } catch (err) {
    error(`❌ Error in test-report-moderation endpoint: ${err.message}`);
    return res.status(500).json({ 
      success: false, 
      message: `Server error: ${err.message}` 
    });
  }
});

/**
 * @swagger
 * /api/webhook/health:
 *   get:
 *     summary: Check webhook health
 *     description: Returns status of webhook service
 *     responses:
 *       200:
 *         description: Service is healthy
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

/**
 * Process a newly submitted report with AI
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const processNewReport = async (req, res) => {
  try {
    // Verify webhook secret
    const webhookSecret = req.headers['x-webhook-secret'];
    if (webhookSecret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized webhook request'
      });
    }
    
    const { reportId } = req.body;
    
    if (!reportId) {
      return res.status(400).json({
        success: false,
        message: 'Report ID is required'
      });
    }
    
    // Acknowledge webhook receipt immediately
    res.status(202).json({
      success: true,
      message: 'Report processing initiated'
    });
    
    // Process the report asynchronously
    processReportAsync(reportId);
    
  } catch (err) {
    // Use shared safe error handling
    const safeError = geminiAI.getSafeErrorDetails(err);
    error(`Error in webhook processNewReport: ${safeError.name} - ${safeError.message}`);
    return res.status(500).json({
      success: false,
      message: 'Server error processing webhook'
    });
  }
};

/**
 * Process a report asynchronously with Gemini AI
 * @param {string} reportId - Report ID to process
 */
const processReportAsync = async (reportId) => {
  try {
    info(`Starting AI processing for report ${reportId}`);
    
    const result = await autoModeration.processReportWithAI(reportId);
    
    // Safely log the result without circular references
    const safeResult = {
      success: result.success,
      message: result.message,
      action: result.action || 'unknown'
    };
    
    if (result.success) {
      info(`AI successfully processed report ${reportId}: ${safeResult.message}`);
    } else {
      error(`AI failed to process report ${reportId}: ${safeResult.message}`);
      
      // Log the error details if available
      if (result.error) {
        error(`Error details for report ${reportId}: ${result.error}`);
      }
    }
  } catch (err) {
    // Use shared safe error handling
    const safeError = geminiAI.getSafeErrorDetails(err);
    
    error(`Error in processReportAsync for report ${reportId}: ${safeError.name} - ${safeError.message}`);
    
    // Attempt to add additional debugging information
    try {
      if (err.stack) {
        const stackSummary = err.stack.split('\n').slice(0, 3).join('\n');
        error(`Stack trace summary: ${stackSummary}`);
      }
    } catch (stackError) {
      // Ignore errors when trying to extract the stack
    }
  }
};

// Add route for report processing
router.post('/report-processing', processNewReport);

module.exports = router; 