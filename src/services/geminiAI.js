const axios = require('axios');
const logger = require('../utils/logger');

// Configuration for Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Updated API URL - Gemini 1.0 Pro is the stable version of the API
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro:generateContent';

/**
 * Analyze message content to determine if it violates platform guidelines
 * @param {string} messageContent - The content of the message to analyze
 * @returns {Promise<Object>} Analysis result with decision and explanation
 */
const analyzeMessageContent = async (messageContent) => {
  try {
    logger.info('🤖 Starting Gemini AI content analysis');
    
    if (!GEMINI_API_KEY) {
      logger.error('❌ Gemini API key not configured');
      throw new Error('Gemini AI service not configured');
    }

    logger.info('🤖 Preparing prompt for content analysis');
    
    const prompt = `
      You are a content moderation AI for a social app. Analyze the following message and determine if it violates platform guidelines.
      
      Message: "${messageContent}"
      
      Classify this message into one of these categories:
      1. INAPPROPRIATE - Contains hate speech, harassment, explicit content, threats, etc.
      2. BORDERLINE - May be offensive but doesn't clearly violate guidelines
      3. ACCEPTABLE - Does not violate any guidelines
      
      Provide your classification and a brief explanation for your decision.
      
      Format your response as a JSON object with these fields:
      {
        "classification": "INAPPROPRIATE|BORDERLINE|ACCEPTABLE",
        "confidence": 0-1 (your confidence level),
        "explanation": "brief explanation",
        "violatedPolicies": ["list of specific policies violated, if any"]
      }
    `;

    logger.info('🤖 Sending request to Gemini API');
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 500
        }
      }
    );
    
    logger.info('🤖 Received response from Gemini API');

    // Check if response contains expected data
    if (!response.data || !response.data.candidates || !response.data.candidates[0]?.content?.parts?.[0]?.text) {
      logger.error('❌ Unexpected Gemini API response format:', JSON.stringify(response.data));
      throw new Error('Invalid response format from Gemini API');
    }

    // Extract the response text
    const generatedText = response.data.candidates[0].content.parts[0].text;
    
    // Parse the JSON from the response
    const startIndex = generatedText.indexOf('{');
    const endIndex = generatedText.lastIndexOf('}') + 1;
    
    if (startIndex === -1 || endIndex === 0) {
      logger.error('❌ Could not find JSON in Gemini response:', generatedText);
      // Fallback response for when Gemini doesn't return proper JSON
      return {
        classification: "ACCEPTABLE",
        confidence: 0.9,
        explanation: "Fallback analysis due to error. Message appears to be acceptable.",
        violatedPolicies: []
      };
    }
    
    const jsonStr = generatedText.substring(startIndex, endIndex);
    
    try {
      // Parse and return the analysis
      const result = JSON.parse(jsonStr);
      logger.info('🤖 Successfully parsed Gemini response:', result.classification);
      return result;
    } catch (jsonError) {
      logger.error('❌ Failed to parse Gemini JSON response:', jsonError);
      logger.error('Raw response:', generatedText);
      // Fallback response for when JSON parsing fails
      return {
        classification: "ACCEPTABLE", 
        confidence: 0.9,
        explanation: "Fallback analysis due to error. Message appears to be acceptable.",
        violatedPolicies: []
      };
    }
  } catch (error) {
    logger.error('❌ Error analyzing message with Gemini AI:', error);
    // Return a fallback response instead of throwing error to prevent system failure
    return {
      classification: "ACCEPTABLE",
      confidence: 0.9,
      explanation: "Fallback analysis due to API error. Message assumed acceptable.",
      violatedPolicies: []
    };
  }
};

/**
 * Evaluate user report history to determine if action is needed
 * @param {Array} reportHistory - User's prior reports
 * @param {Object} messageAnalysis - Results from content analysis
 * @returns {Object} Decision about user action
 */
const evaluateUserHistory = async (reportHistory, messageAnalysis) => {
  try {
    if (!GEMINI_API_KEY) {
      logger.error('Gemini API key not configured');
      throw new Error('Gemini AI service not configured');
    }

    const reportHistoryText = reportHistory.map(report => 
      `- Report ${report.id}: Type "${report.report_type}", Status "${report.status}", Date "${report.created_at}"`
    ).join('\n');

    const prompt = `
      You are a user moderation AI for a social app. Analyze a user's report history and the latest content analysis to determine if action should be taken.
      
      User Report History:
      ${reportHistoryText}
      
      Latest Content Analysis:
      Classification: ${messageAnalysis.classification}
      Confidence: ${messageAnalysis.confidence}
      Explanation: ${messageAnalysis.explanation}
      Violated Policies: ${messageAnalysis.violatedPolicies ? messageAnalysis.violatedPolicies.join(', ') : 'None'}
      
      Determine if this user should be:
      1. BANNED - Multiple serious violations or pattern of abuse
      2. WARNED - Borderline or first serious violation
      3. NO_ACTION - False reports or minor issues
      
      Format your response as a JSON object with these fields:
      {
        "action": "BANNED|WARNED|NO_ACTION",
        "confidence": 0-1 (your confidence level),
        "explanation": "brief explanation",
        "recommendedBanDuration": "PERMANENT|7_DAYS|30_DAYS" (only if action is BANNED)
      }
    `;

    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 500
        }
      }
    );

    // Check if response contains expected data
    if (!response.data || !response.data.candidates || !response.data.candidates[0]?.content?.parts?.[0]?.text) {
      logger.error('❌ Unexpected Gemini API response format:', JSON.stringify(response.data));
      return {
        action: "NO_ACTION",
        confidence: 0.9,
        explanation: "Fallback decision due to API error. No action taken."
      };
    }
    
    // Extract the response text
    const generatedText = response.data.candidates[0].content.parts[0].text;
    
    // Parse the JSON from the response
    const startIndex = generatedText.indexOf('{');
    const endIndex = generatedText.lastIndexOf('}') + 1;
    
    if (startIndex === -1 || endIndex === 0) {
      logger.error('❌ Could not find JSON in Gemini response:', generatedText);
      return {
        action: "NO_ACTION",
        confidence: 0.9,
        explanation: "Fallback decision due to parsing error. No action taken."
      };
    }
    
    const jsonStr = generatedText.substring(startIndex, endIndex);
    
    try {
      // Parse and return the recommendation
      return JSON.parse(jsonStr);
    } catch (jsonError) {
      logger.error('❌ Failed to parse Gemini JSON response:', jsonError);
      return {
        action: "NO_ACTION",
        confidence: 0.9,
        explanation: "Fallback decision due to parsing error. No action taken."
      };
    }
  } catch (error) {
    logger.error('Error evaluating user with Gemini AI:', error);
    return {
      action: "NO_ACTION",
      confidence: 0.9,
      explanation: "Fallback decision due to API error. No action taken."
    };
  }
};

module.exports = {
  analyzeMessageContent,
  evaluateUserHistory
}; 