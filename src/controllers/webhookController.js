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
    logger.error('Error in webhook processNewReport:', error);
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
    
    if (result.success) {
      logger.info(`AI successfully processed report ${reportId}: ${result.message}`);
    } else {
      logger.error(`AI failed to process report ${reportId}: ${result.message}`);
    }
  } catch (error) {
    logger.error(`Error in processReportAsync for report ${reportId}:`, error);
  }
};

module.exports = {
  processNewReport
}; 