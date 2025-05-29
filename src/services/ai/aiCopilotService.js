/**
 * Mock AI Copilot Service that provides fallback responses
 * This replaces the actual AI service with predefined responses
 */

const logger = require('../../utils/logger');
const { info, error } = logger;

/**
 * Generate profile recommendations (mock)
 * @param {object} userProfile - User profile to generate recommendations for
 * @returns {Promise<object>} Profile recommendations
 */
const generateProfileRecommendations = async (userProfile) => {
  info(`Mock profile recommendations called for user ${userProfile.id || 'unknown'}`);
  
  return {
    bioSuggestions: [
      "Share more about your favorite hobbies and interests to connect with like-minded people!",
      "Add details about what you're looking for in a connection to attract the right matches.",
      "Consider adding more photos to showcase your personality and lifestyle."
    ],
    interestSuggestions: [
      "Hiking",
      "Photography",
      "Cooking",
      "Reading",
      "Travel"
    ],
    completionScore: 75,
    feedback: "Your profile is mostly complete but could benefit from a few more details to stand out."
  };
};

/**
 * Generate conversation starters (mock)
 * @param {object} match - Match information with user profiles
 * @returns {Promise<Array>} Conversation starters
 */
const generateConversationStarters = async (match) => {
  info(`Mock conversation starters called for match ${match.id || 'unknown'}`);
  
  return [
    "What's the most interesting thing you've done recently?",
    "If you could travel anywhere right now, where would you go?",
    "What's your favorite way to spend a weekend?",
    "Do you have any recommendations for good books or shows?",
    "What's something you're really looking forward to?"
  ];
};

/**
 * Get message reply suggestions (mock)
 * @param {Array} conversationHistory - Conversation history between users
 * @returns {Promise<Array>} Reply suggestions
 */
const getMessageReplySuggestions = async (conversationHistory) => {
  info('Mock message reply suggestions called');
  
  return [
    "That sounds really interesting! Tell me more.",
    "I can relate to that. What else are you into?",
    "That's cool! I had a similar experience once.",
    "Great point! I'd love to hear more about that."
  ];
};

/**
 * Generate activity recommendations (mock)
 * @param {object} userProfile - User profile
 * @param {object} preferences - User preferences
 * @returns {Promise<Array>} Activity recommendations
 */
const generateActivityRecommendations = async (userProfile, preferences) => {
  info(`Mock activity recommendations called for user ${userProfile.id || 'unknown'}`);
  
  return [
    {
      type: "outdoor",
      activity: "Visit a local park",
      reason: "Based on your interests in nature and outdoor activities"
    },
    {
      type: "dining",
      activity: "Try a new restaurant",
      reason: "Perfect for getting to know someone over good food"
    },
    {
      type: "entertainment",
      activity: "Check out a local music venue",
      reason: "A fun way to discover shared music tastes"
    }
  ];
};

/**
 * Get compatibility insights (mock)
 * @param {object} user1 - First user profile
 * @param {object} user2 - Second user profile
 * @returns {Promise<object>} Compatibility insights
 */
const getCompatibilityInsights = async (user1, user2) => {
  info(`Mock compatibility insights called between users ${user1.id || 'unknown'} and ${user2.id || 'unknown'}`);
  
  return {
    score: 75,
    sharedInterests: (user1.interests || [])
      .filter(interest => (user2.interests || []).includes(interest)),
    complementaryTraits: [
      "You both enjoy outdoor activities",
      "You have similar tastes in movies"
    ],
    conversationTopics: [
      "Travel destinations",
      "Favorite books",
      "Weekend activities"
    ]
  };
};

module.exports = {
  generateProfileRecommendations,
  generateConversationStarters,
  getMessageReplySuggestions,
  generateActivityRecommendations,
  getCompatibilityInsights
}; 