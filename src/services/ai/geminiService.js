/**
 * Mock Gemini AI service that provides fallback responses
 * This file replaces the actual AI service with simple predefined responses
 */
const logger = require('../../utils/logger');
const { info, error } = logger;

/**
 * Analyze user-generated text for safety (mock)
 * @param {string} text - Text to analyze
 * @returns {Promise<object>} Analysis results
 */
const analyzeText = async (text) => {
  info('Mock text analysis called');
  return {
    safe: true,
    categories: {},
    flagged: false
  };
};

/**
 * Generate AI-powered chat response (mock)
 * @param {string} prompt - User prompt
 * @param {object} context - Context for response
 * @returns {Promise<string>} Generated response
 */
const generateChatResponse = async (prompt, context = {}) => {
  const responses = [
    "That's interesting! Tell me more.",
    "I see what you mean. What else is on your mind?",
    "That's a good point. How do you feel about it?",
    "Interesting perspective! What made you think of that?",
    "I agree with you on that.",
    "Thanks for sharing that with me.",
    "I appreciate your thoughts on this topic.",
    "Let's talk more about that!",
    "What else would you like to discuss?",
    "That's fascinating. Can you elaborate?"
  ];
  
  info('Mock chat response generation called');
  return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Generate text content (mock)
 * @param {string} prompt - User prompt
 * @returns {Promise<string>} Generated text
 */
const generateContent = async (prompt) => {
  info('Mock content generation called');
  return "This is a fallback response since AI features have been disabled.";
};

/**
 * Summarize a text (mock)
 * @param {string} text - Text to summarize
 * @returns {Promise<string>} Summary
 */
const summarizeText = async (text) => {
  info('Mock text summarization called');
  return "This is a summary placeholder.";
};

/**
 * Answer a question based on text (mock)
 * @param {string} question - Question to answer
 * @param {string} context - Context for the question
 * @returns {Promise<string>} Answer
 */
const answerQuestion = async (question, context) => {
  info('Mock question answering called');
  return "I don't have enough information to answer this question accurately.";
};

module.exports = {
  analyzeText,
  generateChatResponse,
  generateContent,
  summarizeText,
  answerQuestion
}; 