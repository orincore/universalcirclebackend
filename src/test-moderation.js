/**
 * Test script for automated content moderation
 * 
 * This script:
 * 1. Creates a test message with inappropriate content
 * 2. Reports the message
 * 3. Tests the automated moderation system
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./database/dbConfig');
const { info, error, warn } = require('./utils/logger');

// Configuration
const API_URL = 'http://localhost:5000/api';
const TEST_USER_ID_1 = '11111111-1111-1111-1111-111111111111'; // Sender
const TEST_USER_ID_2 = '22222222-2222-2222-2222-222222222222'; // Reporter

// Test messages with varying levels of inappropriate content
const testMessages = [
  {
    content: "Hello, how are you today? I hope you're having a great day!",
    description: "Clean message - should be classified as ACCEPTABLE"
  },
  {
    content: "This product is so damn frustrating to use sometimes.",
    description: "Borderline message with mild profanity - might be BORDERLINE"
  },
  {
    content: "I hate you and your stupid ideas. You're an idiot.",
    description: "Offensive message with personal attacks - should be INAPPROPRIATE"
  },
  {
    content: "I'm going to find where you live and hurt you.",
    description: "Threatening message - should be INAPPROPRIATE with high confidence"
  }
];

/**
 * Create a test conversation between two users
 */
async function createTestConversation() {
  try {
    const conversationId = uuidv4();
    const client = await pool.connect();
    
    try {
      // Create conversation
      await client.query(
        `INSERT INTO conversations (id, created_at, updated_at) 
         VALUES ($1, NOW(), NOW())`,
        [conversationId]
      );
      
      // Add participants
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, joined_at) 
         VALUES ($1, $2, NOW()), ($1, $3, NOW())`,
        [conversationId, TEST_USER_ID_1, TEST_USER_ID_2]
      );
      
      info(`✅ Created test conversation: ${conversationId}`);
      return conversationId;
    } finally {
      client.release();
    }
  } catch (error) {
    error(`❌ Error creating test conversation: ${error.message}`);
    throw error;
  }
}

/**
 * Create a test message in the conversation
 */
async function createTestMessage(conversationId, messageContent) {
  try {
    const messageId = uuidv4();
    const client = await pool.connect();
    
    try {
      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, content, created_at) 
         VALUES ($1, $2, $3, $4, NOW())`,
        [messageId, conversationId, TEST_USER_ID_1, messageContent]
      );
      
      info(`✅ Created test message: ${messageId}`);
      return messageId;
    } finally {
      client.release();
    }
  } catch (error) {
    error(`❌ Error creating test message: ${error.message}`);
    throw error;
  }
}

/**
 * Report the message through the webhook API
 */
async function reportMessage(messageId, messageContent) {
  try {
    const response = await axios.post(`${API_URL}/webhooks/test-report-moderation`, {
      message_id: messageId,
      reported_by: TEST_USER_ID_2,
      reported_user_id: TEST_USER_ID_1,
      reason: 'Inappropriate content'
    });
    
    info('✅ Report processed successfully');
    info(`📊 Analysis result: ${JSON.stringify(response.data.report.ai_analysis)}`);
    info(`🔍 Resolution: ${response.data.report.resolution_notes}`);
    info(`🗑️ Message deleted: ${response.data.report.message_deleted ? 'Yes' : 'No'}`);
    
    return response.data;
  } catch (error) {
    error(`❌ Error reporting message: ${error.response?.data?.message || error.message}`);
    throw error;
  }
}

/**
 * Check if message still exists in the database
 */
async function checkMessageExists(messageId) {
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(
        'SELECT id FROM messages WHERE id = $1',
        [messageId]
      );
      
      const exists = result.rows.length > 0;
      info(`🔍 Message ${messageId} exists: ${exists}`);
      return exists;
    } finally {
      client.release();
    }
  } catch (error) {
    error(`❌ Error checking message: ${error.message}`);
    throw error;
  }
}

/**
 * Run the full test
 */
async function runTest() {
  try {
    info('🚀 Starting automated moderation test');
    
    // Create test conversation
    const conversationId = await createTestConversation();
    
    // Test each message
    for (const [index, testMessage] of testMessages.entries()) {
      info(`\n📝 TEST ${index + 1}: ${testMessage.description}`);
      info(`📝 Message content: "${testMessage.content}"`);
      
      // Create test message
      const messageId = await createTestMessage(conversationId, testMessage.content);
      
      // Report the message
      const reportResult = await reportMessage(messageId, testMessage.content);
      
      // Check if message still exists
      const messageExists = await checkMessageExists(messageId);
      
      info(`📊 Test ${index + 1} Result: ${messageExists ? 'Message remains' : 'Message deleted'}`);
      info('---------------------------------------------------');
    }
    
    info('✅ All tests completed');
  } catch (error) {
    error(`❌ Test failed: ${error.message}`);
  }
}

// Run the test
runTest(); 