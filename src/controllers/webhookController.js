const logger = require('../utils/logger');
const autoModeration = require('../services/autoModeration');

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
    
  } catch (error) {
    // Safe error handling
    const safeError = {
      message: error.message,
      name: error.name,
      code: error.code
    };
    logger.error('Error in webhook processNewReport:', safeError);
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
    logger.info(`Starting AI processing for report ${reportId}`);
    
    const result = await autoModeration.processReportWithAI(reportId);
    
    // Safely log the result without circular references
    const safeResult = {
      success: result.success,
      message: result.message,
      action: result.action || 'unknown'
    };
    
    if (result.success) {
      logger.info(`AI successfully processed report ${reportId}: ${safeResult.message}`);
    } else {
      logger.error(`AI failed to process report ${reportId}: ${safeResult.message}`);
      
      // Log the error details if available
      if (result.error) {
        logger.error(`Error details for report ${reportId}: ${result.error}`);
      }
    }
  } catch (error) {
    // Safe error handling to avoid circular references
    const safeError = {
      message: error.message || 'Unknown error',
      name: error.name || 'UnknownError',
      code: error.code
    };
    
    logger.error(`Error in processReportAsync for report ${reportId}: ${safeError.name} - ${safeError.message}`);
    
    // Attempt to add additional debugging information
    try {
      if (error.stack) {
        const stackSummary = error.stack.split('\n').slice(0, 3).join('\n');
        logger.error(`Stack trace summary: ${stackSummary}`);
      }
    } catch (stackError) {
      // Ignore errors when trying to extract the stack
    }
  }
};

module.exports = {
  processNewReport
}; 