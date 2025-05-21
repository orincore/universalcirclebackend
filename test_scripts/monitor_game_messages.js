const axios = require('axios');
const dotenv = require('dotenv');
const io = require('socket.io-client');
dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5001';
let AUTH_TOKEN = '';
let CONVERSATION_ID = '';
let socket;

// Login to get auth token
const login = async () => {
  try {
    console.log('Logging in...');
    
    const loginResponse = await axios.post(`${API_URL}/api/auth/login`, {
      email: process.env.TEST_USER1_EMAIL || 'testuser1@example.com',
      password: process.env.TEST_USER1_PASSWORD || 'password123'
    });
    
    AUTH_TOKEN = loginResponse.data.data.token;
    console.log(`Logged in successfully as: ${loginResponse.data.data.user.username}`);
    
    return loginResponse.data.data.user;
  } catch (error) {
    console.error('Login failed:', error.response?.data || error.message);
    throw error;
  }
};

// Get conversation ID (from command line or first conversation)
const getConversationId = async () => {
  // Check if conversation ID is provided as command line argument
  const args = process.argv.slice(2);
  if (args.length > 0) {
    CONVERSATION_ID = args[0];
    console.log(`Using conversation ID from command line: ${CONVERSATION_ID}`);
    return CONVERSATION_ID;
  }
  
  // Otherwise get the first conversation from the API
  try {
    console.log('Fetching conversations...');
    
    const response = await axios.get(`${API_URL}/api/messages/conversations`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    });
    
    if (!response.data.data?.conversations || response.data.data.conversations.length === 0) {
      throw new Error('No conversations found');
    }
    
    CONVERSATION_ID = response.data.data.conversations[0].id;
    console.log(`Using first conversation ID: ${CONVERSATION_ID}`);
    
    return CONVERSATION_ID;
  } catch (error) {
    console.error('Failed to get conversations:', error.response?.data || error.message);
    throw error;
  }
};

// Connect to socket.io server
const connectSocket = (userId) => {
  return new Promise((resolve, reject) => {
    try {
      console.log('Connecting to socket server...');
      
      // Connect to socket server
      socket = io(API_URL, {
        transports: ['websocket'],
        auth: {
          token: AUTH_TOKEN
        }
      });
      
      // Handle connection events
      socket.on('connect', () => {
        console.log('Socket connected successfully');
        
        // Join user's room
        socket.emit('join', { userId });
        
        // Join conversation room
        socket.emit('joinConversation', { conversationId: CONVERSATION_ID });
        
        resolve(socket);
      });
      
      socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        reject(err);
      });
      
      // Monitor all events
      socket.onAny((event, ...args) => {
        console.log(`[SOCKET EVENT] ${event}:`, JSON.stringify(args, null, 2));
      });
      
    } catch (error) {
      console.error('Socket connection failed:', error.message);
      reject(error);
    }
  });
};

// Get message history for conversation
const getMessageHistory = async () => {
  try {
    console.log(`Fetching message history for conversation ${CONVERSATION_ID}...`);
    
    const response = await axios.get(`${API_URL}/api/messages/conversations/${CONVERSATION_ID}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    });
    
    return response.data.data?.messages || [];
  } catch (error) {
    console.error('Failed to get message history:', error.response?.data || error.message);
    return [];
  }
};

// Find game-related messages in the history
const findGameMessages = (messages) => {
  const gameMessages = messages.filter(msg => 
    msg.message_type === 'game_invitation' || 
    msg.message_type === 'game_accepted' || 
    msg.message_type === 'game_move' || 
    msg.message_type === 'game_completed'
  );
  
  return gameMessages;
};

// Monitor messages and games in conversation
const monitorConversation = async () => {
  try {
    console.log('Starting game message monitoring...');
    
    // Login first
    const user = await login();
    
    // Get conversation ID
    await getConversationId();
    
    // Connect socket
    await connectSocket(user.id);
    
    // Get message history
    const messages = await getMessageHistory();
    
    // Find game messages
    const gameMessages = findGameMessages(messages);
    console.log(`\nFound ${gameMessages.length} game-related messages in history:`);
    
    // Display game messages
    gameMessages.forEach((msg, index) => {
      console.log(`\n--- Game Message ${index + 1} ---`);
      console.log(`Type: ${msg.message_type}`);
      console.log(`Content: ${msg.content}`);
      console.log(`From: ${msg.sender_id}`);
      if (msg.metadata) {
        console.log('Game Details:');
        console.log(JSON.stringify(msg.metadata, null, 2));
      }
      console.log('--------------------------');
    });
    
    console.log('\n\nMonitoring for new game messages in real-time...');
    console.log('(Press Ctrl+C to exit)\n');
    
    // Register specific handlers for game events
    socket.on('message', (data) => {
      if (data.message_type && data.message_type.startsWith('game_')) {
        console.log('\n=== NEW GAME MESSAGE ===');
        console.log(`Type: ${data.message_type}`);
        console.log(`Content: ${data.content}`);
        console.log(`From: ${data.sender_id}`);
        if (data.metadata) {
          console.log('Game Details:');
          console.log(JSON.stringify(data.metadata, null, 2));
        }
        console.log('=======================\n');
      }
    });
    
    socket.on('game_invitation', (data) => {
      console.log('\n=== NEW GAME INVITATION ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('===========================\n');
    });
    
    socket.on('game_accepted', (data) => {
      console.log('\n=== GAME ACCEPTED ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('====================\n');
    });
    
    socket.on('game_move', (data) => {
      console.log('\n=== GAME MOVE ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('================\n');
    });
    
    socket.on('game_completed', (data) => {
      console.log('\n=== GAME COMPLETED ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('=====================\n');
    });
    
  } catch (error) {
    console.error('Monitoring failed:', error);
  }
};

// Run the monitor
monitorConversation(); 