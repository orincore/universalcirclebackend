const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');
const { info, error } = require('../../utils/logger');

// Load environment variables if not already loaded
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Generate personalized message suggestions based on conversation history
 * @param {Array} messageHistory - Previous messages in the conversation
 * @param {object} userContext - Context about the user (interests, preferences)
 * @returns {Promise<Array>} - Array of suggested messages
 */
async function generateMessageSuggestions(messageHistory, userContext) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    // Format conversation history for the prompt
    const formattedHistory = messageHistory.map(msg => 
      `${msg.senderName}: ${msg.content}`).join('\n');
    
    // Build prompt with user context and conversation
    const prompt = `Based on the following conversation between users and context:
    
User interests: ${userContext.interests.join(', ')}
User preference: ${userContext.preference || 'Not specified'}
Recent conversation:
${formattedHistory}

Generate 3 natural, engaging message suggestions to continue this conversation. Each suggestion should be brief (under 150 characters) and conversational. Return only the messages as a numbered list with no additional text.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Parse the generated text into an array of suggestions
    const suggestions = text.split('\n')
      .filter(line => line.trim().match(/^\d+\.\s/)) // Lines starting with number and period
      .map(line => line.replace(/^\d+\.\s/, '').trim()) // Remove numbering
      .slice(0, 3); // Ensure we have max 3 suggestions
    
    return suggestions;
  } catch (err) {
    error(`Error generating message suggestions: ${err.message}`);
    return [];
  }
}

/**
 * Generate AI-powered profile bio based on user information
 * @param {object} userInfo - User information for bio generation
 * @returns {Promise<string>} - Generated bio
 */
async function generateProfileBio(userInfo) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `Create an engaging dating app bio for a person with the following characteristics:

Age: ${userInfo.age || 'Not specified'}
Gender: ${userInfo.gender || 'Not specified'}
Interests: ${userInfo.interests ? userInfo.interests.join(', ') : 'Not specified'}
Location: ${userInfo.location || 'Not specified'}
Occupation: ${userInfo.occupation || 'Not specified'}

The bio should be friendly, authentic, and around 2-3 sentences long. Do not use hashtags or emojis. Focus on their interests and personality. Return only the bio text with no additional comments.`;

    const result = await model.generateContent(prompt);
    const bio = result.response.text().trim();
    
    return bio;
  } catch (err) {
    error(`Error generating profile bio: ${err.message}`);
    return '';
  }
}

/**
 * Detect conversation mood from recent messages
 * @param {Array} recentMessages - Recent messages in the conversation
 * @returns {Promise<object>} - Detected mood with confidence scores
 */
async function detectConversationMood(recentMessages) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    // Format message content for analysis
    const messageContent = recentMessages.map(msg => msg.content).join('\n');
    
    const prompt = `Analyze the emotional tone of the following conversation messages:

${messageContent}

Determine the dominant emotional tone/mood of this conversation. Categorize it as one of the following: happy, excited, neutral, bored, sad, or anxious. Also include confidence percentage (1-100) in your assessment.

Format your response as JSON only: {"mood": "emotion_name", "confidence": confidence_score}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Parse JSON response from the text
    const jsonMatch = text.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { mood: 'neutral', confidence: 0 };
  } catch (err) {
    error(`Error detecting conversation mood: ${err.message}`);
    return { mood: 'neutral', confidence: 0 };
  }
}

/**
 * Generate personalized icebreakers based on user profiles
 * @param {object} user1 - First user profile
 * @param {object} user2 - Second user profile
 * @returns {Promise<Array>} - Array of icebreaker questions
 */
async function generateIcebreakers(user1, user2) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `Generate 3 personalized icebreaker questions for a conversation between two people with these profiles:

Person 1:
- Interests: ${user1.interests ? user1.interests.join(', ') : 'Not specified'}
- Bio: ${user1.bio || 'Not provided'}

Person 2:
- Interests: ${user2.interests ? user2.interests.join(', ') : 'Not specified'}
- Bio: ${user2.bio || 'Not provided'}

Focus on their shared interests if any exist. Questions should be specific, engaging, and likely to start a meaningful conversation. Return only the questions as a numbered list, with no additional text.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Parse the generated text into an array of icebreakers
    const icebreakers = text.split('\n')
      .filter(line => line.trim().match(/^\d+\.\s/))
      .map(line => line.replace(/^\d+\.\s/, '').trim())
      .slice(0, 3);
    
    return icebreakers;
  } catch (err) {
    error(`Error generating icebreakers: ${err.message}`);
    return [];
  }
}

/**
 * Generate personalized notifications based on user activity
 * @param {object} userActivity - User activity data
 * @returns {Promise<object>} - Personalized notification content
 */
async function generatePersonalizedNotification(userActivity) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `Generate a personalized notification for a dating/social app user with the following recent activity:

- Days since last login: ${userActivity.daysSinceLogin || 'Unknown'}
- Unread messages: ${userActivity.unreadMessages || 0}
- New matches: ${userActivity.newMatches || 0}
- Active conversations: ${userActivity.activeConversations || 0}
- Conversation streak about to expire: ${userActivity.streakAboutToExpire ? 'Yes' : 'No'}
- Current streak days: ${userActivity.currentStreakDays || 0}

Create a short, engaging notification message (max 100 characters) that would encourage the user to return to the app. Return only the notification text with no additional comments.`;

    const result = await model.generateContent(prompt);
    const notificationText = result.response.text().trim();
    
    return {
      text: notificationText,
      type: determineNotificationType(userActivity),
      priority: calculatePriority(userActivity)
    };
  } catch (err) {
    error(`Error generating personalized notification: ${err.message}`);
    return {
      text: generateFallbackNotification(userActivity),
      type: determineNotificationType(userActivity),
      priority: calculatePriority(userActivity)
    };
  }
}

/**
 * Generate a fallback notification if AI fails
 * @param {object} userActivity - User activity data
 * @returns {string} - Fallback notification text
 */
function generateFallbackNotification(userActivity) {
  if (userActivity.unreadMessages > 0) {
    return `You have ${userActivity.unreadMessages} unread messages waiting for you!`;
  } else if (userActivity.newMatches > 0) {
    return `You have ${userActivity.newMatches} new matches! Connect with them now.`;
  } else if (userActivity.streakAboutToExpire) {
    return `Don't break your ${userActivity.currentStreakDays}-day streak! Send a message now.`;
  } else {
    return 'Check out what\'s new in the app today!';
  }
}

/**
 * Determine notification type based on user activity
 * @param {object} userActivity - User activity data
 * @returns {string} - Notification type
 */
function determineNotificationType(userActivity) {
  if (userActivity.streakAboutToExpire) return 'streak_alert';
  if (userActivity.unreadMessages > 0) return 'message_reminder';
  if (userActivity.newMatches > 0) return 'match_reminder';
  return 'engagement';
}

/**
 * Calculate notification priority based on user activity
 * @param {object} userActivity - User activity data
 * @returns {number} - Priority score (1-10)
 */
function calculatePriority(userActivity) {
  let score = 5; // Default priority
  
  if (userActivity.streakAboutToExpire) score += 3;
  if (userActivity.unreadMessages > 5) score += 2;
  if (userActivity.daysSinceLogin > 3) score += 2;
  
  return Math.min(Math.max(score, 1), 10); // Ensure between 1-10
}

module.exports = {
  generateMessageSuggestions,
  generateProfileBio,
  detectConversationMood,
  generateIcebreakers,
  generatePersonalizedNotification
}; 