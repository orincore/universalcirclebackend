const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5001';
const TEST_USER1 = process.env.TEST_USER1;
const TEST_USER2 = process.env.TEST_USER2;
let AUTH_TOKEN1 = '';
let AUTH_TOKEN2 = '';
let CONVERSATION_ID = '';
let GAME_INSTANCE_ID = '';

// Helper for pretty-printing responses
const logResponse = (title, data) => {
  console.log(`\n==== ${title} ====`);
  console.log(JSON.stringify(data, null, 2));
  console.log('====================\n');
};

// Login as test users to get authentication tokens
const login = async () => {
  try {
    console.log('Logging in as test users...');
    
    // Login as first user
    const loginResponse1 = await axios.post(`${API_URL}/api/auth/login`, {
      email: 'testuser1@example.com',
      password: 'password123'
    });
    
    AUTH_TOKEN1 = loginResponse1.data.data.token;
    console.log(`User 1 logged in successfully: ${loginResponse1.data.data.user.username}`);
    
    // Login as second user
    const loginResponse2 = await axios.post(`${API_URL}/api/auth/login`, {
      email: 'testuser2@example.com',
      password: 'password123'
    });
    
    AUTH_TOKEN2 = loginResponse2.data.data.token;
    console.log(`User 2 logged in successfully: ${loginResponse2.data.data.user.username}`);
    
    return {
      user1: loginResponse1.data.data.user,
      user2: loginResponse2.data.data.user
    };
  } catch (error) {
    console.error('Login failed:', error.response?.data || error.message);
    throw error;
  }
};

// Get or create conversation between users
const getOrCreateConversation = async (user1Id, user2Id) => {
  try {
    console.log('Getting or creating conversation between users...');
    
    const response = await axios.post(`${API_URL}/api/messages/conversations`, 
      { userId: user2Id },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN1}` } }
    );
    
    CONVERSATION_ID = response.data.data.conversation.id;
    console.log(`Conversation created/retrieved with ID: ${CONVERSATION_ID}`);
    return response.data.data;
  } catch (error) {
    console.error('Failed to get/create conversation:', error.response?.data || error.message);
    throw error;
  }
};

// Test getting available games
const testGetAvailableGames = async () => {
  try {
    console.log('Testing GET /api/games/available endpoint...');
    
    const response = await axios.get(`${API_URL}/api/games/available`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN1}` }
    });
    
    logResponse('Available Games', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to get available games:', error.response?.data || error.message);
    throw error;
  }
};

// Test getting active games in a conversation
const testGetActiveGamesInConversation = async () => {
  try {
    console.log(`Testing GET /api/games/conversation/${CONVERSATION_ID} endpoint...`);
    
    const response = await axios.get(`${API_URL}/api/games/conversation/${CONVERSATION_ID}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN1}` }
    });
    
    logResponse('Active Games in Conversation', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to get active games in conversation:', error.response?.data || error.message);
    throw error;
  }
};

// Test creating a new game
const testCreateGame = async (user1Id, user2Id) => {
  try {
    console.log('Testing POST /api/games/create endpoint...');
    
    const response = await axios.post(`${API_URL}/api/games/create`, 
      {
        conversationId: CONVERSATION_ID,
        gameType: 'emoji_guess',
        responderId: user2Id
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN1}` } }
    );
    
    GAME_INSTANCE_ID = response.data.game.id;
    logResponse('Created Game', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to create game:', error.response?.data || error.message);
    throw error;
  }
};

// Test getting a specific game instance
const testGetGameInstance = async () => {
  try {
    console.log(`Testing GET /api/games/${GAME_INSTANCE_ID} endpoint...`);
    
    const response = await axios.get(`${API_URL}/api/games/${GAME_INSTANCE_ID}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN1}` }
    });
    
    logResponse('Game Instance Details', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to get game instance:', error.response?.data || error.message);
    throw error;
  }
};

// Test accepting a game invitation
const testAcceptGame = async () => {
  try {
    console.log(`Testing POST /api/games/${GAME_INSTANCE_ID}/accept endpoint...`);
    
    const response = await axios.post(`${API_URL}/api/games/${GAME_INSTANCE_ID}/accept`,
      {},
      { headers: { Authorization: `Bearer ${AUTH_TOKEN2}` } }
    );
    
    logResponse('Game Acceptance Result', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to accept game:', error.response?.data || error.message);
    throw error;
  }
};

// Test making moves in the game
const testMakeMove = async (userId, authToken, moveData) => {
  try {
    console.log(`Testing POST /api/games/${GAME_INSTANCE_ID}/move endpoint for user ${userId}...`);
    
    const response = await axios.post(`${API_URL}/api/games/${GAME_INSTANCE_ID}/move`,
      moveData,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    
    logResponse('Move Result', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to make move:', error.response?.data || error.message);
    throw error;
  }
};

// Run all tests in sequence
const runAllTests = async () => {
  try {
    console.log('Starting Mini-Games API tests...');
    
    // Login and get user details
    const users = await login();
    
    // Get or create conversation
    const conversation = await getOrCreateConversation(users.user1.id, users.user2.id);
    
    // Test getting available games
    await testGetAvailableGames();
    
    // Test getting active games in conversation (likely empty at this point)
    await testGetActiveGamesInConversation();
    
    // Test creating a new game
    await testCreateGame(users.user1.id, users.user2.id);
    
    // Test getting the game instance
    await testGetGameInstance();
    
    // Test getting active games again (should now include our game)
    await testGetActiveGamesInConversation();
    
    // Test accepting the game
    await testAcceptGame();
    
    // Test making moves by both players (emoji_guess game)
    // User 1 makes a move (first turn determined by the game)
    const moveResult1 = await testMakeMove(users.user1.id, AUTH_TOKEN1, { 
      guess: "Running fast" 
    });
    
    // If game is not complete, let User 2 make a move
    if (!moveResult1.isComplete) {
      await testMakeMove(users.user2.id, AUTH_TOKEN2, { 
        guess: "Thinking"
      });
    }
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test suite failed:', error);
  }
};

// Run the tests
runAllTests(); 