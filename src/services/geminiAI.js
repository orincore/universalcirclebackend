const axios = require('axios');
const { info, error, warn } = require('../utils/logger');

// Configuration for Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Updated to use the newest model version based on official docs: https://ai.google.dev/gemini-api/docs/quickstart?lang=rest
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Configure retry settings
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Make API call with exponential backoff for handling rate limits
 * @param {Object} config - Axios request configuration
 * @param {Number} retryCount - Current retry attempt (internal use)
 * @param {Number} delay - Current delay in milliseconds (internal use)
 * @returns {Promise<Object>} API response
 */
const makeApiCallWithRetry = async (config, retryCount = 0, delay = INITIAL_RETRY_DELAY) => {
  try {
    return await axios(config);
  } catch (error) {
    // Check if error is a rate limit (429) or server error (5xx)
    const isRateLimitError = error.response && error.response.status === 429;
    const isServerError = error.response && error.response.status >= 500 && error.response.status < 600;
    
    // Only retry for rate limit or server errors, and if we haven't exceeded max retries
    if ((isRateLimitError || isServerError) && retryCount < MAX_RETRIES) {
      // Calculate exponential backoff with jitter
      const jitter = Math.random() * 0.3 + 0.85; // Random value between 0.85-1.15
      const nextDelay = delay * 2 * jitter;
      
      // Log the retry
      warn(`Gemini API request failed with ${error.response?.status || 'unknown error'}. Retrying in ${Math.round(nextDelay)}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      // Wait for the calculated delay
      await new Promise(resolve => setTimeout(resolve, nextDelay));
      
      // Retry the request with incremented retry count and updated delay
      return makeApiCallWithRetry(config, retryCount + 1, nextDelay);
    }
    
    // If we've exhausted retries or it's not a retryable error, throw the error
    throw error;
  }
};

/**
 * Safely extract error details to avoid circular references
 * @param {Error} error - The error object
 * @returns {Object} Safe error object without circular references
 */
const getSafeErrorDetails = (error) => {
  try {
    // Extract only the properties we care about
    return {
      message: error.message || 'Unknown error',
      name: error.name || 'UnknownError',
      code: error.code,
      status: error.status,
      // Only include stack in development
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  } catch (e) {
    // If anything goes wrong, return a simple error object
    return { message: 'Error extracting error details', name: 'ErrorExtractionError' };
  }
};

/**
 * Analyze message content to determine if it violates platform guidelines
 * @param {string} messageContent - The content of the message to analyze
 * @returns {Promise<Object>} Analysis result with decision and explanation
 */
const analyzeMessageContent = async (messageContent) => {
  try {
    info('🤖 Starting Gemini AI content analysis');
    
    if (!GEMINI_API_KEY) {
      error('❌ Gemini API key not configured');
      throw new Error('Gemini AI service not configured');
    }

    info('🤖 Preparing prompt for content analysis');
    
    const prompt = `
      You are a content moderation AI for a social app. Analyze the following message and determine if it violates platform guidelines.
      
      Message: "${messageContent}"
      
      Classify this message into one of these categories:
      1. INAPPROPRIATE - Contains hate speech, harassment, explicit sexual content, threats, violence, illegal activity, terrorism, child exploitation, self-harm, etc.
      2. BORDERLINE - May be offensive or concerning but doesn't clearly violate guidelines (mild profanity, adult themes without explicit content, etc.)
      3. ACCEPTABLE - Does not violate any guidelines
      
      For clarity:
      - Explicit sexual content, harassment, threats, hate speech, and discrimination are considered INAPPROPRIATE with high confidence
      - Messages that clearly indicate illegal activity are INAPPROPRIATE with high confidence
      - Give higher confidence scores (0.85+) when you are certain the message violates guidelines
      - Give lower confidence scores (0.5-0.7) when there is ambiguity
      
      Provide your classification and a detailed explanation for your decision.
      
      Format your response as a JSON object with these fields:
      {
        "classification": "INAPPROPRIATE|BORDERLINE|ACCEPTABLE",
        "confidence": 0-1 (your confidence level, use 0.85+ for clear violations),
        "explanation": "brief explanation",
        "violatedPolicies": ["list of specific policies violated, if any"],
        "recommendedAction": "DELETE|WARNING|NONE" (DELETE for serious violations, WARNING for borderline)
      }
    `;

    info('🤖 Sending request to Gemini API');
    
    try {
      const requestConfig = {
        method: 'post',
        url: `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        data: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 500
          }
        }
      };
      
      // Use the retry function instead of direct axios call
      const response = await makeApiCallWithRetry(requestConfig);
      
      info('🤖 Received response from Gemini API');

      // Check if response contains expected data
      if (!response.data || !response.data.candidates || !response.data.candidates[0]?.content?.parts?.[0]?.text) {
        error('❌ Unexpected Gemini API response format:', JSON.stringify(response.data));
        throw new Error('Invalid response format from Gemini API');
      }

      // Extract the response text
      const generatedText = response.data.candidates[0].content.parts[0].text;
      
      // Parse the JSON from the response
      const startIndex = generatedText.indexOf('{');
      const endIndex = generatedText.lastIndexOf('}') + 1;
      
      if (startIndex === -1 || endIndex === 0) {
        error('❌ Could not find JSON in Gemini response:', generatedText);
        // Fallback response for when Gemini doesn't return proper JSON
        return {
          classification: "ACCEPTABLE",
          confidence: 0.9,
          explanation: "Fallback analysis due to error. Message appears to be acceptable.",
          violatedPolicies: [],
          recommendedAction: "NONE"
        };
      }
      
      const jsonStr = generatedText.substring(startIndex, endIndex);
      
      try {
        // Parse and return the analysis
        const result = JSON.parse(jsonStr);
        info(`🤖 Successfully parsed Gemini response: ${result.classification} (confidence: ${result.confidence})`);
        
        // Ensure the result has the recommendedAction field
        if (!result.recommendedAction) {
          if (result.classification === "INAPPROPRIATE" && result.confidence >= 0.85) {
            result.recommendedAction = "DELETE";
          } else if (result.classification === "INAPPROPRIATE" || 
                   (result.classification === "BORDERLINE" && result.confidence >= 0.7)) {
            result.recommendedAction = "WARNING";
          } else {
            result.recommendedAction = "NONE";
          }
        }
        
        return result;
      } catch (jsonError) {
        error('❌ Failed to parse Gemini JSON response:', getSafeErrorDetails(jsonError));
        error('Raw response:', generatedText);
        // Fallback response for when JSON parsing fails
        return {
          classification: "ACCEPTABLE", 
          confidence: 0.9,
          explanation: "Fallback analysis due to error. Message appears to be acceptable.",
          violatedPolicies: [],
          recommendedAction: "NONE"
        };
      }
    } catch (axiosError) {
      // Handle Axios errors specifically to avoid circular references
      const safeError = getSafeErrorDetails(axiosError);
      error(`❌ Axios error calling Gemini API: ${safeError.name} - ${safeError.message}`);
      
      // Check if it's a 404 error indicating wrong endpoint
      if (axiosError.response && axiosError.response.status === 404) {
        error('❌ 404 error: API endpoint may be incorrect. Check GEMINI_API_URL value.');
      }
      
      throw new Error(`Gemini API request failed: ${safeError.message}`);
    }
  } catch (error) {
    // Handle all other errors
    const safeError = getSafeErrorDetails(error);
    error(`❌ Error analyzing message with Gemini AI: ${safeError.name} - ${safeError.message}`);
    
    // Return a fallback response instead of throwing error to prevent system failure
    return {
      classification: "ACCEPTABLE",
      confidence: 0.9,
      explanation: "Fallback analysis due to API error. Message assumed acceptable.",
      violatedPolicies: [],
      recommendedAction: "NONE"
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
      error('Gemini API key not configured');
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

    try {
      const requestConfig = {
        method: 'post',
        url: `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        data: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 500
          }
        }
      };
      
      // Use the retry function instead of direct axios call
      const response = await makeApiCallWithRetry(requestConfig);

      // Check if response contains expected data
      if (!response.data || !response.data.candidates || !response.data.candidates[0]?.content?.parts?.[0]?.text) {
        error('❌ Unexpected Gemini API response format:', JSON.stringify(response.data));
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
        error('❌ Could not find JSON in Gemini response:', generatedText);
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
        const safeError = getSafeErrorDetails(jsonError);
        error(`❌ Failed to parse Gemini JSON response: ${safeError.name} - ${safeError.message}`);
        return {
          action: "NO_ACTION",
          confidence: 0.9,
          explanation: "Fallback decision due to parsing error. No action taken."
        };
      }
    } catch (axiosError) {
      // Handle Axios errors specifically to avoid circular references
      const safeError = getSafeErrorDetails(axiosError);
      error(`❌ Axios error in evaluateUserHistory: ${safeError.name} - ${safeError.message}`);
      
      throw new Error(`Gemini API request failed: ${safeError.message}`);
    }
  } catch (error) {
    const safeError = getSafeErrorDetails(error);
    error(`Error evaluating user with Gemini AI: ${safeError.name} - ${safeError.message}`);
    return {
      action: "NO_ACTION",
      confidence: 0.9,
      explanation: "Fallback decision due to API error. No action taken."
    };
  }
};

/**
 * Generate content using Gemini AI
 * @param {string} prompt - The prompt to send to Gemini
 * @returns {Promise<Object>} Response with text method
 */
const generateContent = async (prompt) => {
  try {
    info('🤖 Starting Gemini AI content generation');
    
    if (!GEMINI_API_KEY) {
      error('❌ Gemini API key not configured');
      throw new Error('Gemini AI service not configured');
    }

    info('🤖 Sending request to Gemini API');
    
    try {
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
      
      info('🤖 Received response from Gemini API');

      // Check if response contains expected data
      if (!response.data || !response.data.candidates || !response.data.candidates[0]?.content?.parts?.[0]?.text) {
        error('❌ Unexpected Gemini API response format:', JSON.stringify(response.data));
        throw new Error('Invalid response format from Gemini API');
      }

      // Extract the response text
      const generatedText = response.data.candidates[0].content.parts[0].text;
      
      // Return an object with a text() method to match expected interface
      return {
        text: () => generatedText
      };
      
    } catch (axiosError) {
      // Handle Axios errors specifically to avoid circular references
      const safeError = getSafeErrorDetails(axiosError);
      error(`❌ Axios error calling Gemini API: ${safeError.name} - ${safeError.message}`);
      
      // Check if it's a 404 error indicating wrong endpoint
      if (axiosError.response && axiosError.response.status === 404) {
        error('❌ 404 error: API endpoint may be incorrect. Check GEMINI_API_URL value.');
      }
      
      throw new Error(`Gemini API request failed: ${safeError.message}`);
    }
  } catch (error) {
    // Handle all other errors
    const safeError = getSafeErrorDetails(error);
    error(`❌ Error generating content with Gemini AI: ${safeError.name} - ${safeError.message}`);
    throw error;
  }
};

module.exports = {
  analyzeMessageContent,
  evaluateUserHistory,
  getSafeErrorDetails,
  generateContent  // Export the new function
}; 