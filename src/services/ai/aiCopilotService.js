const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../../utils/logger');
const { supabase } = require('../../config/database');
const userService = require('../userService');

// Initialize the Google Gemini API client
let genAI = null;
try {
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    logger.info('Gemini AI service initialized successfully');
  } else {
    logger.warn('GEMINI_API_KEY not found in environment variables. AI features will use fallback responses.');
  }
} catch (error) {
  logger.error('Failed to initialize Gemini AI service', error);
}

/**
 * Generate contextual message suggestions for a conversation
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<string[]>} - List of suggested messages
 */
async function generateMessageSuggestions(conversationId) {
  try {
    if (!conversationId) {
      throw new Error('Conversation ID is required');
    }

    // If Gemini is not available, return fallback suggestions
    if (!genAI) {
      logger.info('Using fallback message suggestions for conversation', { conversationId });
      return getFallbackMessageSuggestions();
    }

    // Fetch conversation data
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (conversationError || !conversation) {
      logger.error('Error fetching conversation data', { conversationId, error: conversationError });
      return getFallbackMessageSuggestions();
    }

    // Fetch the last 20 messages from the conversation
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (messagesError || !messages || messages.length === 0) {
      logger.warn('No messages found or error fetching messages', { conversationId, error: messagesError });
      return getFallbackMessageSuggestions();
    }

    // Fetch user profiles
    const user1 = await userService.getUserById(conversation.user1_id);
    const user2 = await userService.getUserById(conversation.user2_id);

    if (!user1 || !user2) {
      logger.warn('Could not fetch both user profiles', { conversationId });
      return getFallbackMessageSuggestions();
    }

    // Format conversation history for the AI
    const messageHistory = messages
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(msg => {
        const sender = msg.sender_id === user1.id ? user1.username : user2.username;
        return `${sender}: ${msg.content}`;
      })
      .join('\n');

    // Create the prompt for Gemini
    const prompt = `You are helping generate message suggestions for a dating app conversation.

User 1: ${user1.username}
Interests: ${user1.profile?.interests?.join(', ') || 'Not specified'}

User 2: ${user2.username}
Interests: ${user2.profile?.interests?.join(', ') || 'Not specified'}

Recent conversation:
${messageHistory}

Based on this conversation history and the users' interests, generate 3 short, natural message suggestions that user1 might want to send next. Each suggestion should be a single sentence or short question that fits naturally in the conversation flow. Make them friendly, engaging, and relevant to topics they've been discussing or their mutual interests.

Format your response as a list of suggestions only, one per line. Do not include anything else.`;

    // Generate suggestions using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Parse the suggestions from the response
    const suggestions = text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, '').trim()) // Remove numbering if present
      .slice(0, 3); // Only take the first 3 suggestions
    
    if (suggestions.length === 0) {
      logger.warn('No valid suggestions extracted from AI response', { conversationId });
      return getFallbackMessageSuggestions();
    }

    // Store the suggestions in the analytics table for future improvement
    await storeConversationAnalytics(conversationId, 'message_suggestions', {
      suggestions,
      generated_at: new Date().toISOString()
    });
    
    return suggestions;
  } catch (error) {
    logger.error('Error generating message suggestions', { conversationId, error });
    return getFallbackMessageSuggestions();
  }
}

/**
 * Generate a profile bio for a user based on their data
 * @param {string} userId - ID of the user
 * @returns {Promise<string>} - Generated profile bio
 */
async function generateProfileBio(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // If Gemini is not available, return fallback bio
    if (!genAI) {
      logger.info('Using fallback profile bio for user', { userId });
      return getFallbackProfileBio();
    }

    // Fetch user data
    const user = await userService.getUserById(userId);
    if (!user) {
      logger.error('User not found', { userId });
      return getFallbackProfileBio();
    }

    // Prepare user data for the prompt
    const userData = {
      age: user.age || 'Not specified',
      gender: user.gender || 'Not specified',
      location: user.location || 'Not specified',
      interests: user.profile?.interests?.join(', ') || 'Not specified',
      education: user.profile?.education || 'Not specified',
      occupation: user.profile?.occupation || 'Not specified',
      looking_for: user.profile?.looking_for || 'Not specified'
    };

    // Create the prompt for Gemini
    const prompt = `You are helping generate a profile bio for a dating app user. Here's information about the user:

Age: ${userData.age}
Gender: ${userData.gender}
Location: ${userData.location}
Interests: ${userData.interests}
Education: ${userData.education}
Occupation: ${userData.occupation}
Looking for: ${userData.looking_for}

Based on this information, write a friendly, engaging, and authentic profile bio of about 2-3 sentences that highlights their personality and interests. The bio should be written in first person ("I") and should sound natural, not overly formal or robotic. Make it warm, approachable, and uniquely tailored to them.

Return only the bio text with no additional explanation or formatting.`;

    // Generate bio using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const bio = response.text().trim();
    
    if (!bio || bio.length < 10) {
      logger.warn('Generated bio was too short or empty', { userId });
      return getFallbackProfileBio();
    }
    
    return bio;
  } catch (error) {
    logger.error('Error generating profile bio', { userId, error });
    return getFallbackProfileBio();
  }
}

/**
 * Generate icebreaker questions for a match based on mutual interests
 * @param {string} matchId - ID of the match
 * @returns {Promise<string[]>} - List of icebreaker questions
 */
async function generateIcebreakers(matchId) {
  try {
    if (!matchId) {
      throw new Error('Match ID is required');
    }

    // If Gemini is not available, return fallback icebreakers
    if (!genAI) {
      logger.info('Using fallback icebreakers for match', { matchId });
      return getFallbackIcebreakers();
    }

    // Fetch match data
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      logger.error('Error fetching match data', { matchId, error: matchError });
      return getFallbackIcebreakers();
    }

    // Fetch user profiles
    const user1 = await userService.getUserById(match.user1_id);
    const user2 = await userService.getUserById(match.user2_id);

    if (!user1 || !user2) {
      logger.warn('Could not fetch both user profiles', { matchId });
      return getFallbackIcebreakers();
    }

    // Find mutual interests
    const user1Interests = user1.profile?.interests || [];
    const user2Interests = user2.profile?.interests || [];
    const mutualInterests = user1Interests.filter(interest => user2Interests.includes(interest));

    // Create the prompt for Gemini
    const prompt = `You are helping generate icebreaker questions for a dating app match. Here's information about the two users:

User 1:
- Name: ${user1.username}
- Age: ${user1.age || 'Not specified'}
- Interests: ${user1Interests.join(', ') || 'Not specified'}
- Occupation: ${user1.profile?.occupation || 'Not specified'}

User 2:
- Name: ${user2.username}
- Age: ${user2.age || 'Not specified'}
- Interests: ${user2Interests.join(', ') || 'Not specified'}
- Occupation: ${user2.profile?.occupation || 'Not specified'}

${mutualInterests.length > 0 ? `Mutual interests: ${mutualInterests.join(', ')}` : 'They don\'t appear to have mutual interests listed.'}

Generate 3 thoughtful, engaging, and specific icebreaker questions that User 1 could send to User 2 to start a conversation. The questions should be related to their profiles, especially focusing on mutual interests if they exist. Make the questions open-ended to encourage detailed responses.

Format your response as a list of questions only, one per line. Do not include anything else.`;

    // Generate icebreakers using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Parse the icebreakers from the response
    const icebreakers = text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, '').trim()) // Remove numbering if present
      .slice(0, 3); // Only take the first 3 icebreakers
    
    if (icebreakers.length === 0) {
      logger.warn('No valid icebreakers extracted from AI response', { matchId });
      return getFallbackIcebreakers();
    }
    
    return icebreakers;
  } catch (error) {
    logger.error('Error generating icebreakers', { matchId, error });
    return getFallbackIcebreakers();
  }
}

/**
 * Detect the mood/emotional tone of a conversation
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<{mood: string, confidence: number}>} - The detected mood and confidence score
 */
async function detectConversationMood(conversationId) {
  try {
    if (!conversationId) {
      throw new Error('Conversation ID is required');
    }

    // If Gemini is not available, return fallback mood analysis
    if (!genAI) {
      logger.info('Using fallback mood analysis for conversation', { conversationId });
      return getFallbackMoodAnalysis();
    }

    // Fetch the last 30 messages from the conversation
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (messagesError || !messages || messages.length < 3) {
      // Need at least a few messages to detect mood
      logger.warn('Not enough messages for mood detection', { conversationId, count: messages?.length });
      return getFallbackMoodAnalysis();
    }

    // Format messages for analysis
    const formattedMessages = messages
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(msg => `${msg.sender_id}: ${msg.content}`)
      .join('\n');

    // Create the prompt for Gemini
    const prompt = `You are analyzing the mood/emotional tone of a conversation on a dating app. Here's a transcript of the most recent messages:

${formattedMessages}

Based on this conversation, determine the predominant mood or emotional tone of the interaction. Choose from the following options:
- happy
- excited
- neutral
- bored
- sad
- anxious
- romantic
- friendly
- tense
- confused

Also provide a confidence score from 0-100 indicating how confident you are in this assessment.

Format your response as a JSON object with 'mood' and 'confidence' properties. For example:
{
  "mood": "friendly",
  "confidence": 85
}`;

    // Generate mood analysis using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    try {
      // Parse the JSON response
      const moodData = JSON.parse(text);
      
      if (!moodData.mood || typeof moodData.confidence !== 'number') {
        throw new Error('Invalid mood data format');
      }
      
      // Store the mood analysis in the analytics table
      await storeConversationAnalytics(conversationId, 'mood_analysis', {
        mood: moodData.mood,
        confidence: moodData.confidence,
        analyzed_at: new Date().toISOString()
      });
      
      return {
        mood: moodData.mood,
        confidence: moodData.confidence
      };
    } catch (parseError) {
      logger.error('Error parsing mood analysis response', { conversationId, error: parseError, response: text });
      return getFallbackMoodAnalysis();
    }
  } catch (error) {
    logger.error('Error detecting conversation mood', { conversationId, error });
    return getFallbackMoodAnalysis();
  }
}

/**
 * Generate a personalized re-engagement message for an inactive user
 * @param {string} userId - ID of the user
 * @returns {Promise<string>} - Generated re-engagement message
 */
async function generateReEngagementMessage(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // If Gemini is not available, return fallback message
    if (!genAI) {
      logger.info('Using fallback re-engagement message for user', { userId });
      return getFallbackReEngagementMessage();
    }

    // Fetch user data
    const user = await userService.getUserById(userId);
    if (!user) {
      logger.error('User not found', { userId });
      return getFallbackReEngagementMessage();
    }

    // Get recent activity data
    const { data: activityData, error: activityError } = await supabase
      .from('user_activity')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(10);

    // Get recent matches
    const { data: recentMatches, error: matchesError } = await supabase
      .from('matches')
      .select('*, user1:user1_id(*), user2:user2_id(*)')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(3);

    // Create the prompt for Gemini
    const prompt = `You are generating a personalized re-engagement notification for a dating app user who hasn't been active for a few days. Here's information about the user:

Username: ${user.username}
Age: ${user.age || 'Not specified'}
Gender: ${user.gender || 'Not specified'}
Interests: ${user.profile?.interests?.join(', ') || 'Not specified'}

${recentMatches && recentMatches.length > 0 ? 
  `Recent matches: ${recentMatches.length} new matches waiting to chat with them` : 
  'No recent matches found'}

${activityData && activityData.length > 0 ? 
  `Last activity: ${activityData[0].activity_type} on ${new Date(activityData[0].timestamp).toLocaleDateString()}` :
  'No recent activity data available'}

Write a short, friendly, and personalized notification message (maximum 120 characters) to encourage this user to return to the app. Make it feel relevant to their specific situation and interests. The message should create a sense of FOMO (fear of missing out) or curiosity.

Return only the notification message text with no additional explanation or formatting.`;

    // Generate message using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const message = response.text().trim();
    
    if (!message || message.length < 10 || message.length > 150) {
      logger.warn('Generated re-engagement message was invalid', { userId, length: message?.length });
      return getFallbackReEngagementMessage();
    }
    
    return message;
  } catch (error) {
    logger.error('Error generating re-engagement message', { userId, error });
    return getFallbackReEngagementMessage();
  }
}

/**
 * Store conversation analytics in the database
 * @param {string} conversationId - ID of the conversation
 * @param {string} analysisType - Type of analysis (e.g., 'mood_analysis', 'message_suggestions')
 * @param {object} analysisData - Analysis data to store
 * @returns {Promise<void>}
 */
async function storeConversationAnalytics(conversationId, analysisType, analysisData) {
  try {
    const { error } = await supabase
      .from('conversation_analytics')
      .insert({
        conversation_id: conversationId,
        analysis_type: analysisType,
        analysis_data: analysisData,
        analyzed_at: new Date().toISOString()
      });

    if (error) {
      throw error;
    }
  } catch (error) {
    logger.error('Error storing conversation analytics', { conversationId, analysisType, error });
    // Non-critical error, so we don't throw
  }
}

// Fallback functions for when the AI service is unavailable

function getFallbackMessageSuggestions() {
  const suggestions = [
    "How's your day going so far?",
    "What do you like to do for fun?",
    "Any exciting plans for the weekend?"
  ];
  return suggestions;
}

function getFallbackProfileBio() {
  return "I'm excited to be here and meet new people! I enjoy exploring new places, trying different cuisines, and having meaningful conversations. Looking forward to connecting with like-minded individuals.";
}

function getFallbackIcebreakers() {
  const icebreakers = [
    "What's the most interesting place you've traveled to?",
    "What's something you're passionate about that you could talk about for hours?",
    "If you could have dinner with anyone, living or dead, who would it be and why?"
  ];
  return icebreakers;
}

function getFallbackMoodAnalysis() {
  return {
    mood: 'neutral',
    confidence: 50
  };
}

function getFallbackReEngagementMessage() {
  const messages = [
    "Hey there! Your matches are wondering where you've been. Come back and say hello!",
    "New people are waiting to meet you! Don't miss out on potential connections.",
    "Take a break from your busy day to check out your new matches!"
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

module.exports = {
  generateMessageSuggestions,
  generateProfileBio,
  generateIcebreakers,
  detectConversationMood,
  generateReEngagementMessage
}; 