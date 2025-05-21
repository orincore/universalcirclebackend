const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5001';
let AUTH_TOKEN1 = '';
let AUTH_TOKEN2 = '';
let CONVERSATION_ID = '';

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
      email: process.env.TEST_USER1_EMAIL || 'testuser1@example.com',
      password: process.env.TEST_USER1_PASSWORD || 'password123'
    });
    
    AUTH_TOKEN1 = loginResponse1.data.data.token;
    console.log(`User 1 logged in successfully: ${loginResponse1.data.data.user.username}`);
    
    // Login as second user
    const loginResponse2 = await axios.post(`${API_URL}/api/auth/login`, {
      email: process.env.TEST_USER2_EMAIL || 'testuser2@example.com',
      password: process.env.TEST_USER2_PASSWORD || 'password123'
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

// Get available games
const getAvailableGames = async () => {
  try {
    console.log('Getting available games...');
    
    const response = await axios.get(`${API_URL}/api/games/available`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN1}` }
    });
    
    return response.data.games || [];
  } catch (error) {
    console.error('Failed to get available games:', error.response?.data || error.message);
    throw error;
  }
};

// Test one full game cycle
const testGameType = async (gameType, user1, user2) => {
  try {
    console.log(`\n\n=== TESTING GAME TYPE: ${gameType} ===`);
    let gameInstanceId = '';
    
    // Step 1: Create game
    console.log(`Creating new ${gameType} game...`);
    const createResponse = await axios.post(`${API_URL}/api/games/create`, 
      {
        conversationId: CONVERSATION_ID,
        gameType: gameType,
        responderId: user2.id
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN1}` } }
    );
    
    gameInstanceId = createResponse.data.game.id;
    console.log(`Game created with ID: ${gameInstanceId}`);
    
    // Step 2: Accept game
    console.log(`User 2 accepting the ${gameType} game...`);
    const acceptResponse = await axios.post(`${API_URL}/api/games/${gameInstanceId}/accept`,
      {},
      { headers: { Authorization: `Bearer ${AUTH_TOKEN2}` } }
    );
    
    const currentTurn = acceptResponse.data.gameState.currentTurn;
    console.log(`Game accepted. First turn: ${currentTurn === user1.id ? 'User 1' : 'User 2'}`);
    
    // Step 3: Make moves based on game type
    const moveData = getMoveDataForGameType(gameType, 1);
    
    // First move by whoever's turn it is
    const firstMoveToken = currentTurn === user1.id ? AUTH_TOKEN1 : AUTH_TOKEN2;
    const firstMoveUserId = currentTurn === user1.id ? user1.id : user2.id;
    
    console.log(`First move (User ${currentTurn === user1.id ? '1' : '2'}): ${JSON.stringify(moveData)}`);
    const moveResponse = await axios.post(`${API_URL}/api/games/${gameInstanceId}/move`,
      moveData,
      { headers: { Authorization: `Bearer ${firstMoveToken}` } }
    );
    
    // If game is not complete, make second move
    if (!moveResponse.data.isComplete) {
      const secondMoveToken = currentTurn === user1.id ? AUTH_TOKEN2 : AUTH_TOKEN1;
      const secondMoveUserId = currentTurn === user1.id ? user2.id : user1.id;
      const secondMoveData = getMoveDataForGameType(gameType, 2);
      
      console.log(`Second move (User ${currentTurn === user1.id ? '2' : '1'}): ${JSON.stringify(secondMoveData)}`);
      await axios.post(`${API_URL}/api/games/${gameInstanceId}/move`,
        secondMoveData,
        { headers: { Authorization: `Bearer ${secondMoveToken}` } }
      );
    }
    
    // Get final game state
    const finalGameResponse = await axios.get(`${API_URL}/api/games/${gameInstanceId}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN1}` }
    });
    
    logResponse(`${gameType.toUpperCase()} GAME RESULT`, finalGameResponse.data);
    console.log(`\n=== TEST COMPLETE FOR ${gameType} ===\n`);
    
    return finalGameResponse.data;
  } catch (error) {
    console.error(`${gameType} test failed:`, error.response?.data || error.message);
    return null;
  }
};

// Helper to generate move data based on game type
const getMoveDataForGameType = (gameType, moveNumber) => {
  switch (gameType) {
    case 'emoji_guess':
      return { guess: moveNumber === 1 ? 'Running fast' : 'Thinking' };
      
    case 'word_association':
      return { word: moveNumber === 1 ? 'beach' : 'sand' };
      
    case 'truth_or_dare':
      return { 
        type: moveNumber === 1 ? 'truth' : 'dare',
        response: moveNumber === 1 ? 'My biggest fear is heights' : 'I did a funny dance'
      };
      
    case 'trivia':
      return { answer: moveNumber === 1 ? 2 : 1 };
      
    case 'two_truths_lie':
      if (moveNumber === 1) {
        return { 
          statements: [
            { text: 'I have visited 10 countries', isTrue: true },
            { text: 'I can speak three languages', isTrue: true },
            { text: 'I have climbed Mount Everest', isTrue: false }
          ],
          truth_index: 2
        };
      } else {
        return { guess: 2 };
      }
      
    default:
      return { data: 'Generic move data' };
  }
};

// Run all game type tests
const runAllGameTests = async () => {
  try {
    console.log('Starting comprehensive game type tests...');
    
    // Login and get user details
    const users = await login();
    
    // Get or create conversation
    await getOrCreateConversation(users.user1.id, users.user2.id);
    
    // Get available games
    const availableGames = await getAvailableGames();
    console.log(`Found ${availableGames.length} available game types`);
    
    // Test each game type
    const results = {};
    for (const game of availableGames) {
      console.log(`Testing game type: ${game.type}`);
      const result = await testGameType(game.type, users.user1, users.user2);
      results[game.type] = result ? 'SUCCESS' : 'FAILED';
    }
    
    console.log('\n\n=== ALL GAME TESTS COMPLETE ===');
    console.log('Results summary:');
    Object.entries(results).forEach(([gameType, result]) => {
      console.log(`${gameType}: ${result}`);
    });
    
  } catch (error) {
    console.error('Test suite failed:', error);
  }
};

// Run the tests
runAllGameTests(); 