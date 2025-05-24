const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../config/database');
const { verifyToken } = require('../utils/jwt');
const logger = require('../utils/logger');

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// Track connected users and their socket IDs
const connectedUsers = new Map();

// Reference to Socket.IO instance
let ioInstance;

// Track active matches with acceptance status
// Format: { matchId: { users: [userId1, userId2], acceptances: { userId1: boolean, userId2: boolean } } }
const activeMatches = new Map();

// Track user timeouts for matchmaking
const userTimeouts = new Map();

// Track users in matchmaking pool waiting for matches
const matchmakingPool = new Map();

// Match acceptance timeout (in milliseconds)
const MATCH_ACCEPTANCE_TIMEOUT = 30000; // 30 seconds
const MATCHMAKING_INTERVAL = 5000; // Check for matches every 5 seconds
const POOL_CLEANUP_INTERVAL = 30000; // Clean the pool every 30 seconds

// Global interval for continuous matchmaking
let matchmakingIntervalId = null;
let poolCleanupIntervalId = null;

// Import AI services
const {
  generateMessageSuggestions,
  generateProfileBio,
  generateIcebreakers,
  detectConversationMood
} = require('../services/ai/aiCopilotService');

// Import AI bot profile service
const { 
  generateBotProfile, 
  generateBotResponse,
  verifyBotExists
} = require('../services/ai/botProfileService');

// Track bot matches and their data
const botMatches = new Map();

// Store match message history for context
const matchMessageHistory = new Map();

// Map user IDs to their socket IDs
const userSocketMap = new Map();

// Logger shorthands
const info = (message) => logger.info(`[SOCKET] ${message}`);
const warn = (message) => logger.warn(`[SOCKET] ${message}`);
const error = (message) => logger.error(`[SOCKET] ${message}`);

/**
 * Clean up the matchmaking pool by removing disconnected users
 */
const cleanMatchmakingPool = () => {
  // Skip verbose logging if the pool is empty
  const poolSize = matchmakingPool.size;
  if (poolSize === 0) {
    // No need to log anything if the pool is already empty
    return;
  }
  
  // Only log when there are actually users in the pool
  info(`Running matchmaking pool cleanup. Current pool size: ${poolSize}`);
  
  // Track how many users were removed
  let removedCount = 0;
  
  // Check each user in the pool
  for (const [userId, userData] of matchmakingPool.entries()) {
    let shouldRemove = false;
    
    // Check if user is connected
    if (!connectedUsers.has(userId)) {
      info(`Cleanup: User ${userId} is not in connected users map. Removing from pool.`);
      shouldRemove = true;
    } else {
      // Check if socket is valid
      const socketId = connectedUsers.get(userId);
      const socket = ioInstance.sockets.sockets.get(socketId);
      if (!socket) {
        info(`Cleanup: User ${userId} has invalid socket ID ${socketId}. Removing from pool.`);
        shouldRemove = true;
        // Also remove from connected users map
        connectedUsers.delete(userId);
      }
    }
    
    // Remove user if needed
    if (shouldRemove) {
      matchmakingPool.delete(userId);
      removedCount++;
      
      // Clear any timeouts
      clearMatchmakingTimeouts(userId);
    }
  }
  
  // Only log if users were actually removed or if debug logging is enabled
  if (removedCount > 0) {
    info(`Matchmaking pool cleanup completed. Removed ${removedCount} users. New pool size: ${matchmakingPool.size}`);
  }
};

/**
 * Find matches for all users in the matchmaking pool
 */
const findMatchesForAllUsers = () => {
  // Clean up the pool first to ensure all users are valid
  cleanMatchmakingPool();
  
  // Skip all processing if the pool is too small
  const poolSize = matchmakingPool.size;
  if (poolSize < 2) {
    // Only log this once every 12 checks (once per minute) to reduce spam
    // Using a timestamp-based approach to avoid needing to store state
    const now = Date.now();
    if (now % (MATCHMAKING_INTERVAL * 12) < MATCHMAKING_INTERVAL) {
      info(`Not enough users in matchmaking pool (${poolSize}). Need at least 2 users.`);
    }
    return;
  }
  
  info(`Running global matchmaking for ${poolSize} users in pool`);
  
  // Convert the map to array for easier processing
  const usersInPool = Array.from(matchmakingPool.values());
  const processedUsers = new Set();
  
  // Process each user
  for (const user of usersInPool) {
    const userId = user.userId;
    
    // Skip if user was already processed, removed from pool, or is being processed
    if (processedUsers.has(userId) || !matchmakingPool.has(userId) || matchmakingPool.get(userId).isBeingProcessed) {
      continue;
    }
    
    // Get user socket
    const socketId = connectedUsers.get(userId);
    if (!socketId) {
      info(`User ${userId} has no socket ID in connected users map, removing from pool`);
      matchmakingPool.delete(userId);
      continue;
    }
    
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (!socket) {
      info(`User ${userId} socket not found, removing from pool`);
      matchmakingPool.delete(userId);
      continue;
    }
    
    // Find a match
    findMatchForUser(socket);
    
    // Mark as processed
    processedUsers.add(userId);
  }
};

/**
 * Start the global matchmaking system
 */
const startGlobalMatchmaking = () => {
  if (matchmakingIntervalId !== null) {
    info('Global matchmaking already running');
    return;
  }
  
  info('Starting global matchmaking system');
  matchmakingIntervalId = setInterval(findMatchesForAllUsers, MATCHMAKING_INTERVAL);
  
  // Also start the pool cleanup interval
  if (poolCleanupIntervalId === null) {
    info('Starting matchmaking pool cleanup system');
    poolCleanupIntervalId = setInterval(cleanMatchmakingPool, POOL_CLEANUP_INTERVAL);
  }
};

/**
 * Stop the global matchmaking system
 */
const stopGlobalMatchmaking = () => {
  if (matchmakingIntervalId === null) {
    info('Global matchmaking not running');
    return;
  }
  
  info('Stopping global matchmaking system');
  clearInterval(matchmakingIntervalId);
  matchmakingIntervalId = null;
  
  // Also stop the pool cleanup interval
  if (poolCleanupIntervalId !== null) {
    info('Stopping matchmaking pool cleanup system');
    clearInterval(poolCleanupIntervalId);
    poolCleanupIntervalId = null;
  }
};

/**
 * Clear any existing matchmaking timeouts for a user
 * @param {string} userId - User ID to clear timeouts for
 */
const clearMatchmakingTimeouts = (userId) => {
  const timeoutId = userTimeouts.get(userId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    userTimeouts.delete(userId);
    info(`Cleared timeout for user ${userId}`);
  }
};

/**
 * Initialize Socket.IO with authentication
 * @param {object} io - Socket.IO server instance
 */
const initializeSocket = (io) => {
  // Store io instance for global access
  ioInstance = io;
  
  // Configure Socket.IO for better performance and reliability with optimal settings
  io.engine.pingTimeout = 60000; // Increased to 60 seconds
  io.engine.pingInterval = 25000; // Increased to 25 seconds
  io.engine.maxHttpBufferSize = 1e6; // 1 MB
  
  // Add connection tracking and limiting per IP
  const connectionsByIP = new Map();
  const MAX_CONNECTIONS_PER_IP = 15;
  const connectionTimes = new Map();
  
  // Enhanced heartbeat mechanism for more reliable connections
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    io.sockets.sockets.forEach((socket) => {
      if (socket.user && socket.user.id) {
        try {
          // Send heartbeat packet with timestamp
          socket.emit('heartbeat', { time: now });
          
          // Track heartbeat response
          if (!socket.lastHeartbeat || now - socket.lastHeartbeat > 45000) {
            // If no heartbeat for 45 seconds, send a ping to check connection
            socket.emit('ping', { time: now }, (response) => {
              if (response) {
                socket.lastHeartbeat = now;
                // Update connection health
                if (socket.connectionStability) {
                  socket.connectionStability.connectionHealth = Math.min(100, 
                    socket.connectionStability.connectionHealth + 10);
                }
              }
            });
          }
          
          // Update user's active status every minute
          if (!socket.lastStatusUpdate || now - socket.lastStatusUpdate > 60000) {
            updateUserOnlineStatus(socket.user.id, true);
            socket.lastStatusUpdate = now;
          }
        } catch (err) {
          error(`Failed to send heartbeat to ${socket.user.id}: ${err.message}`);
          try {
            // Try reconnection strategy instead of immediate disconnect
            socket.emit('reconnect');
          } catch (e) {
            // Only disconnect if reconnection attempt fails
            try {
              socket.disconnect(true);
            } catch (disconnectErr) {
              // Ignore errors during forced disconnect
            }
          }
        }
      }
    });
  }, 15000); // More frequent heartbeats (15 seconds)
  
  // Clean up interval on process exit
  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    process.exit(0);
  });
  
  // Connection rate limiting
  io.use((socket, next) => {
    try {
      const clientIP = socket.handshake.address || 'unknown';
      const now = Date.now();
      
      // Track connections per IP
      if (!connectionsByIP.has(clientIP)) {
        connectionsByIP.set(clientIP, 0);
      }
      
      const currentCount = connectionsByIP.get(clientIP);
      
      // Check if IP has exceeded limit
      if (currentCount >= MAX_CONNECTIONS_PER_IP) {
        warn(`Connection from ${clientIP} rejected: too many connections (${currentCount})`);
        return next(new Error('Too many connections from this IP address'));
      }
      
      // Increment connection count
      connectionsByIP.set(clientIP, currentCount + 1);
      
      // Record connection time for debugging
      if (!connectionTimes.has(clientIP)) {
        connectionTimes.set(clientIP, []);
      }
      connectionTimes.get(clientIP).push(now);
      
      // Limit connection history 
      if (connectionTimes.get(clientIP).length > 100) {
        connectionTimes.get(clientIP).shift();
      }
      
      // When connection is closed, decrement count
      socket.on('disconnect', () => {
        const newCount = connectionsByIP.get(clientIP) - 1;
        if (newCount <= 0) {
          connectionsByIP.delete(clientIP);
        } else {
          connectionsByIP.set(clientIP, newCount);
        }
      });
      
      next();
    } catch (err) {
      error(`Error in connection limiter: ${err.message}`);
      next(); // Continue despite error
    }
  });
  
  // Start the global matchmaking system
  startGlobalMatchmaking();
  
  // Global socket activity middleware to prevent connection staleness
  io.use((socket, next) => {
    const originalEmit = socket.emit;
    
    // Override the emit method to track activity
    socket.emit = function() {
      // Call the original emit method
      originalEmit.apply(socket, arguments);
      
      // Update activity timestamp for any socket communication
      if (socket.connectionStability) {
        socket.connectionStability.lastActivityTime = Date.now();
      }
    };
    
    next();
  });
  
  // Socket.IO middleware for authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: Token required'));
      }
      
      const decoded = verifyToken(token);
      
      if (!decoded) {
        return next(new Error('Authentication error: Invalid token'));
      }
      
      // Check if user exists in database
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId)
        .single();
      
      if (error || !user) {
        return next(new Error('Authentication error: User not found'));
      }
      
      // Attach user to socket
      socket.user = user;
      delete socket.user.password;
      
      // Store user's socket ID in the map
      userSocketMap.set(user.id, socket.id);
      console.log(`[SOCKET DEBUG] User ${user.id} connected with socket ${socket.id}`);
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    
    // Store the user's socket ID in the connected users map
    if (socket.user && socket.user.id) {
      connectedUsers.set(socket.user.id, socket.id);
      console.log(`User ${socket.user.id} connected with socket ${socket.id}`);
    }
    
    // Handle socket disconnection
    socket.on('disconnect', () => {
      if (socket.user) {
        // Remove user's socket ID from the map
        userSocketMap.delete(socket.user.id);
        connectedUsers.delete(socket.user.id);
        console.log(`[SOCKET DEBUG] User ${socket.user.id} disconnected`);
      }
    });
    
    // Handle messages in match rooms
    socket.on('match:message', async (data, callback) => {
      try {
        const { matchId, message } = data;
        const userId = socket.user.id;
        
        console.log(`[MATCH DEBUG] Handling match:message from user ${userId} in match ${matchId}: "${message.substring(0, 30)}..."`);
        
        if (!matchId || !message) {
          const error = { message: 'Match ID and message content are required' };
          socket.emit('error', { source: 'match:message', ...error });
          if (typeof callback === 'function') callback({ success: false, error });
          return;
        }
        
        // Generate a message ID for tracking
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();
        
        // Prepare the message object
        const messageObject = {
          id: messageId,
          senderId: userId,
          senderName: socket.user.username || 'User',
          message,
          timestamp
        };
        
        // Check if socket is in the room
        if (!socket.rooms.has(matchId)) {
          // Auto-join the room if not already in it
          socket.join(matchId);
          console.log(`[MATCH DEBUG] User ${userId} auto-joined match room ${matchId}`);
        }
        
        // Save message to database
        try {
          // Get match data to determine the recipient
          let recipientId;
          
          // Check if this is a bot match
          if (botMatches.has(matchId)) {
            const botMatch = botMatches.get(matchId);
            recipientId = botMatch.botProfile.id;
            console.log(`[MATCH DEBUG] This is a bot match with bot ${recipientId}`);
          } else if (activeMatches.has(matchId)) {
            // Regular user match
            const matchData = activeMatches.get(matchId);
            recipientId = matchData.users.find(id => id !== userId);
            console.log(`[MATCH DEBUG] This is a regular match with recipient ${recipientId}`);
          } else {
            console.error(`[MATCH DEBUG] Match ${matchId} not found in activeMatches or botMatches`);
            throw new Error(`Match ${matchId} not found in activeMatches or botMatches`);
          }
          
          // Insert message into database
          const { error: dbError } = await supabase
            .from('messages')
            .insert({
              id: messageId,
              sender_id: userId,
              receiver_id: recipientId,
              content: message,
              is_read: false,
              created_at: timestamp,
              updated_at: timestamp
            });
          
          if (dbError) {
            console.error(`[MATCH DEBUG] Database error: ${dbError.message}`);
          } else {
            console.log(`[MATCH DEBUG] Saved message to database`);
          }
        } catch (dbError) {
          console.error(`[MATCH DEBUG] Error saving message to database: ${dbError.message}`);
          // Don't fail the operation, continue sending the message
        }
        
        // Emit the message to the match room
        socket.to(matchId).emit('match:message', messageObject);
        console.log(`[MATCH DEBUG] Emitted message to match room ${matchId}`);
        
        // Send confirmation to sender with delivery info
        socket.emit('match:messageSent', {
          ...messageObject,
          matchId,
          deliveryStatus: 'sent',
          recipientCount: 1 // At least one recipient (bot or user)
        });
        console.log(`[MATCH DEBUG] Sent confirmation to sender ${userId}`);
        
        // Check if this is a bot match and handle bot response
        if (botMatches.has(matchId)) {
          console.log(`[MATCH DEBUG] Triggering bot response for match ${matchId}`);
          handleBotResponse(matchId, message, socket);
        }
      } catch (error) {
        console.error(`[MATCH DEBUG] Error handling match message: ${error.message}`);
        socket.emit('error', { 
          source: 'match:message',
          message: 'Failed to process message' 
        });
        if (typeof callback === 'function') callback({ success: false, error: { message: error.message } });
      }
    });
    
    // Add this handler inside the connection handler after the match:message handler
    socket.on('match:accept', async (data, callback) => {
      try {
        const { matchId } = data;
        const userId = socket.user.id;
        
        console.log(`[MATCH DEBUG] User ${userId} accepting match ${matchId}`);
        
        if (!matchId) {
          const error = { message: 'Match ID is required' };
          socket.emit('error', { source: 'match:accept', ...error });
          if (typeof callback === 'function') callback({ success: false, error });
          return;
        }
        
        // Check if match exists
        if (!activeMatches.has(matchId)) {
          console.error(`[MATCH DEBUG] Match ${matchId} not found in activeMatches`);
          const error = { message: 'Match not found' };
          socket.emit('error', { source: 'match:accept', ...error });
          if (typeof callback === 'function') callback({ success: false, error });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        
        // Check if user is part of the match
        if (!matchData.users.includes(userId)) {
          console.error(`[MATCH DEBUG] User ${userId} is not part of match ${matchId}`);
          const error = { message: 'You are not part of this match' };
          socket.emit('error', { source: 'match:accept', ...error });
          if (typeof callback === 'function') callback({ success: false, error });
          return;
        }
        
        // Update acceptance status
        matchData.acceptances[userId] = true;
        activeMatches.set(matchId, matchData);
        
        console.log(`[MATCH DEBUG] Updated acceptance status for user ${userId} in match ${matchId}`);
        
        // Check if this is a bot match
        const isBot = botMatches.has(matchId);
        
        // Check if both users have accepted
        const allAccepted = Object.values(matchData.acceptances).every(status => status === true);
        
        if (allAccepted) {
          console.log(`[MATCH DEBUG] All participants accepted match ${matchId}`);
          
          // Update match status in database
          try {
            const updateResult = await supabase
              .from('matches')
              .update({
                status: 'accepted',
                accepted_at: new Date().toISOString()
              })
              .eq('id', matchId);
              
            if (updateResult.error) {
              console.error(`[MATCH DEBUG] Error updating match status: ${updateResult.error.message}`);
            } else {
              console.log(`[MATCH DEBUG] Updated match status in database`);
            }
          } catch (dbError) {
            console.error(`[MATCH DEBUG] Database error updating match: ${dbError.message}`);
            // Continue despite error - we'll handle match in memory
          }
          
          // Auto-join the match room
          socket.join(matchId);
          console.log(`[MATCH DEBUG] User ${userId} joined match room ${matchId}`);
          
          // Notify all participants that the match is fully accepted
          matchData.users.forEach(participantId => {
            const participantSocketId = connectedUsers.get(participantId);
            if (participantSocketId) {
              ioInstance.to(participantSocketId).emit('match:accepted', {
                matchId,
                accepted: true,
                acceptedBy: matchData.users
              });
            }
          });
          
          // For bot matches, send an initial greeting message after a short delay
          if (isBot) {
            console.log(`[MATCH DEBUG] Preparing bot greeting for match ${matchId}`);
            const botMatch = botMatches.get(matchId);
            
            // Delay to make it seem more natural
            setTimeout(async () => {
              try {
                const botProfile = botMatch.botProfile;
                const botMessageId = uuidv4();
                const timestamp = new Date().toISOString();
                
                // Create a simple greeting message
                const greetingOptions = [
                  `Hi there! I'm ${botProfile.firstName}. Nice to match with you!`,
                  `Hey! I'm excited to chat with you. I'm ${botProfile.firstName} by the way.`,
                  `Hello! Thanks for accepting the match. I'm ${botProfile.firstName} and I enjoy ${botProfile.interests[0]}.`,
                  `Hi! I'm ${botProfile.firstName}. I see we both like ${matchData.sharedInterests[0] || 'interesting things'}. What else are you into?`
                ];
                
                const greeting = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
                
                const messageObject = {
                  id: botMessageId,
                  senderId: botProfile.id,
                  senderName: botProfile.username || botProfile.firstName,
                  message: greeting,
                  timestamp
                };
                
                // Save greeting to database
                try {
                  const { error: dbError } = await supabase
                    .from('messages')
                    .insert({
                      id: botMessageId,
                      sender_id: botProfile.id,
                      receiver_id: userId,
                      content: greeting,
                      is_read: false,
                      created_at: timestamp,
                      updated_at: timestamp
                    });
                    
                  if (dbError) {
                    console.error(`[MATCH DEBUG] Error saving bot greeting: ${dbError.message}`);
                  }
                } catch (dbError) {
                  console.error(`[MATCH DEBUG] Database error saving greeting: ${dbError.message}`);
                }
                
                // Send the greeting to the user
                socket.emit('match:message', messageObject);
                console.log(`[MATCH DEBUG] Sent bot greeting to user ${userId}`);
                
                // Add message to match history
                if (!matchMessageHistory.has(matchId)) {
                  matchMessageHistory.set(matchId, []);
                }
                
                const history = matchMessageHistory.get(matchId);
                history.push({ role: 'assistant', content: greeting });
                
              } catch (greetingError) {
                console.error(`[MATCH DEBUG] Error sending bot greeting: ${greetingError.message}`);
              }
            }, 2000 + Math.random() * 2000); // 2-4 second delay
          }
        } else {
          // Not all accepted yet, just acknowledge this user's acceptance
          socket.emit('match:acceptConfirmed', {
            matchId,
            accepted: true,
            message: 'Your acceptance has been recorded'
          });
          
          if (typeof callback === 'function') {
            callback({
              success: true,
              matchId,
              accepted: true
            });
          }
        }
      } catch (error) {
        console.error(`[MATCH DEBUG] Error handling match acceptance: ${error.message}`);
        socket.emit('error', {
          source: 'match:accept',
          message: 'Failed to process match acceptance'
        });
        
        if (typeof callback === 'function') {
          callback({
            success: false,
            error: { message: error.message }
          });
        }
      }
    });
    
    // Add other socket handlers here
    
  });

  return io;
};

/**
 * Update user's online status in database
 * @param {string} userId - User ID
 * @param {boolean} online - Online status
 */
const updateUserOnlineStatus = async (userId, online) => {
  try {
    const now = new Date();
    
    // Only update last_active timestamp if user is going online or was previously online
    const updateData = online 
      ? { is_online: true, last_active: now } 
      : { is_online: false, last_active: now };
    
    info(`Updating user ${userId} status: ${online ? 'ONLINE' : 'OFFLINE'}`);
    
    await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId);
      
    return true;
  } catch (err) {
    error(`Failed to update online status for user ${userId}: ${err.message}`);
    return false;
  }
};

/**
 * Create a match record in the database
 * @param {string} matchId - Match ID
 * @param {string} user1Id - First user ID
 * @param {string} user2Id - Second user ID
 */
const createMatchInDatabase = async (matchId, user1Id, user2Id) => {
  try {
    console.log(`Creating match record in database: ${matchId} between ${user1Id} and ${user2Id}`);
    
    // Verify both users exist in the database
    const { data: user1, error: user1Error } = await supabase
      .from('users')
      .select('id')
      .eq('id', user1Id)
      .single();
      
    if (user1Error || !user1) {
      error(`User1 ${user1Id} does not exist in database: ${user1Error?.message || 'Not found'}`);
      return { success: false, error: { message: `User ${user1Id} not found in database` } };
    }
    
    const { data: user2, error: user2Error } = await supabase
      .from('users')
      .select('id')
      .eq('id', user2Id)
      .single();
      
    if (user2Error || !user2) {
      error(`User2 ${user2Id} does not exist in database: ${user2Error?.message || 'Not found'}`);
      return { success: false, error: { message: `User ${user2Id} not found in database` } };
    }
    
    // First, check if a match already exists between these users
    const { data: existingMatch, error: queryError } = await supabase
      .from('matches')
      .select('id')
      .or(`user1_id.eq.${user1Id},user1_id.eq.${user2Id}`)
      .or(`user2_id.eq.${user1Id},user2_id.eq.${user2Id}`)
      .limit(1);
    
    if (queryError) {
      console.error('Error checking for existing match:', queryError);
    }
    
    // Get the match data from active matches if it exists
    let matchData = null;
    if (activeMatches.has(matchId)) {
      matchData = activeMatches.get(matchId);
    }
    
    const currentTime = new Date();
    let dbMatchId = matchId; // Store the DB match ID, initialize with our UUID
    
    // If a match already exists, update it instead of creating a new one
    if (existingMatch && existingMatch.length > 0) {
      console.log(`Match already exists between users ${user1Id} and ${user2Id}, updating existing match`);
      
      // Store the existing match ID from the database for reference
      dbMatchId = existingMatch[0].id;
      console.log(`Using existing database match ID: ${dbMatchId}`);
      
      const { data, error } = await supabase
        .from('matches')
        .update({
          status: 'accepted',
          compatibility_score: 100, // Default score for accepted matches
          shared_interests: matchData?.sharedInterests || [],
          chat_room_id: matchId, // Use our UUID for the chat room
          updated_at: currentTime,
          accepted_at: currentTime
        })
        .eq('id', dbMatchId);
        
      if (error) {
        console.error('Error updating existing match in database:', error);
        return { success: false, error };
      }
      
      console.log(`Successfully updated existing match in database: ${dbMatchId}`);
    } else {
      // Insert a new match
      const { data, error } = await supabase
      .from('matches')
      .insert({
        id: matchId, // Use our UUID for the match ID
        user1_id: user1Id,
        user2_id: user2Id,
        status: 'accepted',
          compatibility_score: 100, // Default score for accepted matches
          shared_interests: matchData?.sharedInterests || [],
          chat_room_id: matchId, // Use our UUID for the chat room
          created_at: currentTime,
          updated_at: currentTime,
          accepted_at: currentTime
      });
      
    if (error) {
      console.error('Error creating match in database:', error);
        return { success: false, error };
      }
      
      console.log(`Successfully created match record in database: ${matchId}`);
    }
    
    // Always use the UUID for updating user records
    console.log(`Updating users with match ID: ${matchId} (uuid format)`);
    
    // Update user records to indicate they're in a match
    const updateUser1 = await supabase
      .from('users')
      .update({
        current_match_id: matchId, // Use the UUID matchId for the user record
        updated_at: new Date()
      })
      .eq('id', user1Id);
      
    const updateUser2 = await supabase
      .from('users')
      .update({
        current_match_id: matchId, // Use the UUID matchId for the user record
        updated_at: new Date()
      })
      .eq('id', user2Id);
      
    if (updateUser1.error) {
      console.error(`Error updating user ${user1Id} with match:`, updateUser1.error);
    }
    
    if (updateUser2.error) {
      console.error(`Error updating user ${user2Id} with match:`, updateUser2.error);
    }
    
    return { success: true, matchId };
  } catch (error) {
    console.error('Error creating match in database:', error);
    return { success: false, error };
  }
};

/**
 * Notify users when a match is found
 * @param {object} user1 - User 1
 * @param {object} user2 - User 2
 * @param {array} sharedInterests - Array of shared interests
 */
const notifyMatchFound = (user1, user2, sharedInterests) => {
  // Verify both users have the same preference
  if (user1.preference !== user2.preference) {
    console.error(`Cannot match users with different preferences: ${user1.id} (${user1.preference}) and ${user2.id} (${user2.preference})`);
    return null;
  }

  const preference = user1.preference || 'Unknown'; // Both should have the same preference
  
  // Create a unique match ID using UUID
  const matchId = uuidv4();
  console.log(`Generated UUID match ID: ${matchId}`);
  
  // Add to active matches with appropriate data
  activeMatches.set(matchId, {
    id: matchId,
    users: [user1.id, user2.id],
    sharedInterests,
    preference,
    timestamp: new Date(),
    acceptances: {
      [user1.id]: false,
      [user2.id]: false
    }
  });
  
  console.log(`Match created: ${matchId} between ${user1.id} and ${user2.id} with ${sharedInterests.length} shared interests for ${preference}`);
  console.log(`Match data: ${JSON.stringify(activeMatches.get(matchId))}`);
  
  // Create properly formatted match data for Flutter client
  const user1MatchData = createMatchData(user2, sharedInterests, matchId, preference);
  const user2MatchData = createMatchData(user1, sharedInterests, matchId, preference);
  
  // Get socket IDs directly from the connectedUsers map
  const socket1Id = connectedUsers.get(user1.id);
  const socket2Id = connectedUsers.get(user2.id);
  
  console.log(`User 1 (${user1.id}) socket ID: ${socket1Id || 'not found'}`);
  console.log(`User 2 (${user2.id}) socket ID: ${socket2Id || 'not found'}`);
  
  let bothNotified = true;
  
  // Emit match found event to both users
  if (socket1Id) {
    // Double check that socket is valid
    const socket1 = ioInstance.sockets.sockets.get(socket1Id);
    if (socket1) {
      ioInstance.to(socket1Id).emit('match:found', { match: user1MatchData });
      console.log(`Notified user ${user1.id} about ${preference} match with ${user2.id} using match:found event`);
      console.log(`Emitted data: ${JSON.stringify({ match: user1MatchData })}`);
    } else {
      console.error(`Failed to notify user ${user1.id}: Socket exists in map but is invalid`);
      bothNotified = false;
    }
  } else {
    console.error(`Failed to notify user ${user1.id}: Socket ID not found`);
    bothNotified = false;
  }
  
  if (socket2Id) {
    // Double check that socket is valid
    const socket2 = ioInstance.sockets.sockets.get(socket2Id);
    if (socket2) {
      ioInstance.to(socket2Id).emit('match:found', { match: user2MatchData });
      console.log(`Notified user ${user2.id} about match with ${user1.id} using match:found event`);
      console.log(`Emitted data: ${JSON.stringify({ match: user2MatchData })}`);
    } else {
      console.error(`Failed to notify user ${user2.id}: Socket exists in map but is invalid`);
      bothNotified = false;
    }
  } else {
    console.error(`Failed to notify user ${user2.id}: Socket ID not found`);
    bothNotified = false;
  }
  
  // If either user couldn't be notified, put them back in the matchmaking pool
  if (!bothNotified) {
    // Clean up the match
    activeMatches.delete(matchId);
    
    // Check user 1 socket
    const socket1 = socket1Id ? ioInstance.sockets.sockets.get(socket1Id) : null;
    if (socket1) {
      console.log(`Returning user ${user1.id} to matchmaking pool due to notification failure`);
      matchmakingPool.set(user1.id, {
        userId: user1.id,
        socketId: socket1Id,
        user: user1,
        interests: user1.interests,
        joinedAt: new Date(),
        isBeingProcessed: false
      });
    }
    
    // Check user 2 socket
    const socket2 = socket2Id ? ioInstance.sockets.sockets.get(socket2Id) : null;
    if (socket2) {
      console.log(`Returning user ${user2.id} to matchmaking pool due to notification failure`);
      matchmakingPool.set(user2.id, {
        userId: user2.id,
        socketId: socket2Id,
        user: user2,
        interests: user2.interests,
        joinedAt: new Date(),
        isBeingProcessed: false
      });
    }
  }
  
  return matchId;
};

// Function to create match data in format expected by Flutter client
const createMatchData = (otherUser, sharedInterests, matchId, preference) => {
  // Calculate age from date_of_birth if available
  let age = null;
  if (otherUser.date_of_birth) {
    const birthDate = new Date(otherUser.date_of_birth);
    const today = new Date();
    age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
  }
  
  // Sanitize user data to include only necessary fields
  const sanitizedUser = {
    id: otherUser.id,
    username: otherUser.username || 'Anonymous',
    name: otherUser.name || otherUser.first_name || otherUser.username || 'User',
    profilePicture: otherUser.profilePicture || otherUser.profile_picture_url || null,
    bio: otherUser.bio || null,
    interests: otherUser.interests || [],
    // Add new fields for gender, age, and location
    gender: otherUser.gender || null,
    age: age,
    location: otherUser.location || null
  };
  
  // Format in a way that Match.fromJson in Flutter can parse
  return {
    id: matchId,
    user: sanitizedUser,
    matchingInterests: sharedInterests,
    createdAt: new Date().toISOString(),
    isPending: true,
    preference: preference || otherUser.preference || 'Unknown' // Include preference in match data
  };
};

/**
 * Find a match for a user
 * @param {object} socket - User socket
 */
const findMatchForUser = async (socket) => {
  try {
    const userId = socket.user.id;
    
    // Skip if user not in matchmaking pool or is already being processed
    if (!matchmakingPool.has(userId)) {
      console.log(`User ${userId} not in matchmaking pool, skipping match search`);
      return;
    }
    
    if (matchmakingPool.get(userId).isBeingProcessed) {
      console.log(`User ${userId} is already being processed for a match, skipping`);
      return;
    }
    
    // Mark this user as being processed
    const userPoolData = matchmakingPool.get(userId);
    userPoolData.isBeingProcessed = true;
    matchmakingPool.set(userId, userPoolData);
    
    const userInterests = socket.user.interests || [];
    const userPreference = socket.user.preference || null;
    
    if (userInterests.length === 0) {
      console.log(`User ${userId} has no interests. Cannot find match.`);
      socket.emit('error', { 
        source: 'findRandomMatch',
        message: 'You need to add interests to your profile before matchmaking' 
      });
      // Reset processing flag
      userPoolData.isBeingProcessed = false;
      matchmakingPool.set(userId, userPoolData);
      return;
    }
    
    if (!userPreference) {
      console.log(`User ${userId} has no preference set. Cannot find match.`);
      socket.emit('error', { 
        source: 'findRandomMatch',
        message: 'You need to set your preference (Dating or Friendship) before matchmaking' 
      });
      // Reset processing flag
      userPoolData.isBeingProcessed = false;
      matchmakingPool.set(userId, userPoolData);
      return;
    }
    
    console.log(`Finding match for user ${userId} with interests: ${userInterests.join(', ')} and preference: ${userPreference}`);
    
    // Debug: Log all users in matchmaking pool
    console.log(`Current matchmaking pool size: ${matchmakingPool.size}`);
    for (const [poolUserId, poolUser] of matchmakingPool.entries()) {
      if (poolUserId !== userId) {
        console.log(`Pool user ${poolUserId} with interests: ${poolUser.interests ? poolUser.interests.join(', ') : 'none'} and preference: ${poolUser.user ? poolUser.user.preference : 'unknown'}`);
      }
    }
    
    // Array of potential matches with compatibility scores
    const potentialMatches = [];
    
    // Check all users in the matchmaking pool
    for (const [otherUserId, otherUser] of matchmakingPool.entries()) {
      // Skip self
      if (otherUserId === userId) continue;
      
      // Skip users that are already being processed
      if (otherUser.isBeingProcessed) {
        console.log(`Skipping user ${otherUserId} as they are already being processed`);
        continue;
      }
      
      // Verify that the other user has a valid socket connection
      if (!connectedUsers.has(otherUserId)) {
        console.log(`User ${otherUserId} is in matchmaking pool but has no socket connection. Removing from pool.`);
        matchmakingPool.delete(otherUserId);
        continue;
      }
      
      // Verify that the other user's socket ID is valid
      const otherUserSocketId = connectedUsers.get(otherUserId);
      const otherUserSocket = ioInstance.sockets.sockets.get(otherUserSocketId);
      if (!otherUserSocket) {
        console.log(`User ${otherUserId} has invalid socket ID ${otherUserSocketId}. Removing from pool.`);
        matchmakingPool.delete(otherUserId);
        continue;
      }
      
      // Skip users who don't have matching preferences
      const otherUserPreference = otherUser.user ? otherUser.user.preference : null;
      if (!otherUserPreference || otherUserPreference !== userPreference) {
        console.log(`Skipping user ${otherUserId} due to preference mismatch: User wants ${userPreference}, Other user wants ${otherUserPreference || 'unknown'}`);
        continue;
      }
      
      const otherUserInterests = otherUser.interests || [];
      
      // Skip users with no interests
      if (otherUserInterests.length === 0) continue;
      
      // Apply gender matching rules
      const userGender = socket.user.gender?.toLowerCase() || 'unknown';
      const otherUserGender = otherUser.user?.gender?.toLowerCase() || 'unknown';
      
      // Define LGBTQ+ gender categories
      const lgbtqGenderCategories = [
        'transgender', 'trans', 'non-binary', 'nonbinary', 'genderqueer', 
        'genderfluid', 'agender', 'bigender', 'two-spirit', 'third-gender',
        'queer', 'questioning', 'intersex', 'other'
      ];
      
      const isUserLgbtq = lgbtqGenderCategories.includes(userGender);
      const isOtherUserLgbtq = lgbtqGenderCategories.includes(otherUserGender);
      
      if (userGender === 'unknown' || otherUserGender === 'unknown') {
        console.log(`Skipping user ${otherUserId} due to missing gender information`);
        continue;
      }
      
      // For Dating preference: 
      // 1. Match male with female (heterosexual)
      // 2. Match LGBTQ+ users with other LGBTQ+ users
      if (userPreference === 'Dating') {
        // For heterosexual matching (male-female only)
        if ((userGender === 'male' || userGender === 'female') && 
            (otherUserGender === 'male' || otherUserGender === 'female')) {
          const isHeterosexualMatch = 
            (userGender === 'male' && otherUserGender === 'female') || 
            (userGender === 'female' && otherUserGender === 'male');
          
          if (!isHeterosexualMatch) {
            console.log(`Skipping user ${otherUserId} for heterosexual dating - gender mismatch: User is ${userGender}, Other user is ${otherUserGender}`);
            continue;
          }
        }
        // For LGBTQ+ community matching - they can match with each other
        else if (isUserLgbtq && isOtherUserLgbtq) {
          console.log(`Found potential LGBTQ+ dating match between users ${userId} (${userGender}) and ${otherUserId} (${otherUserGender})`);
          // Allow the match to continue
        }
        // Skip cross-matching between heterosexual and LGBTQ+ users for dating
        else {
          console.log(`Skipping cross-category match for dating: User is ${userGender}, Other user is ${otherUserGender}`);
          continue;
        }
      }
      
      // For Friendship preference: allow LGBTQ+ users to match with any gender
      if (userPreference === 'Friendship') {
        // No gender restrictions for friendship - anyone can match with anyone
        console.log(`Found potential friendship match between users ${userId} (${userGender}) and ${otherUserId} (${otherUserGender})`);
        // Allow the match to continue
      }
      
      // Find shared interests (case-insensitive comparison)
      const sharedInterests = [];
      for (const interest of userInterests) {
        for (const otherInterest of otherUserInterests) {
          if (interest.toLowerCase() === otherInterest.toLowerCase() && 
              !sharedInterests.includes(interest)) {
            sharedInterests.push(interest);
          }
        }
      }
      
      // Only consider matches with at least one shared interest
      if (sharedInterests.length > 0) {
        console.log(`Found ${sharedInterests.length} shared interests between users ${userId} and ${otherUserId} with matching preference: ${userPreference}`);
        
        // Calculate compatibility score (higher with more shared interests)
        const userScore = sharedInterests.length / userInterests.length;
        const otherUserScore = sharedInterests.length / otherUserInterests.length;
        
        // Average of both scores weighted by interest count
        const combinedScore = ((userScore + otherUserScore) / 2) * 100;
        
        potentialMatches.push({
          userId: otherUserId,
          socketId: otherUserSocketId,
          user: otherUser.user,
          sharedInterests,
          score: combinedScore, // Better scoring based on relative interest match
          preference: otherUserPreference
        });
      }
    }
    
    // Sort by score (highest first)
    potentialMatches.sort((a, b) => b.score - a.score);
    
    if (potentialMatches.length > 0) {
      // Get the best match
      const bestMatch = potentialMatches[0];
      console.log(`Found best match for user ${userId}: ${bestMatch.userId} with score ${bestMatch.score.toFixed(2)}, ${bestMatch.sharedInterests.length} shared interests, and matching preference: ${bestMatch.preference}`);
      
      // Generate a match ID
      const matchId = uuidv4();
      
      // Get match data for the other user
      const matchUser = matchmakingPool.get(bestMatch.userId);
      if (!matchUser) {
        console.log(`Selected match ${bestMatch.userId} is no longer in the pool. Skipping.`);
        // Reset processing flag
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
        return;
      }
      
      // Double-check socket connection for both users
      const user1SocketId = connectedUsers.get(userId);
      const user2SocketId = connectedUsers.get(bestMatch.userId);
      
      if (!user1SocketId || !user2SocketId) {
        console.log(`One or both users have invalid socket IDs. Cannot create match.`);
        // Reset processing flag for both users
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
        
        if (matchmakingPool.has(bestMatch.userId)) {
          const otherUserData = matchmakingPool.get(bestMatch.userId);
          otherUserData.isBeingProcessed = false;
          matchmakingPool.set(bestMatch.userId, otherUserData);
        }
        return;
      }
      
      // Mark both users as being processed
      matchUser.isBeingProcessed = true;
      matchmakingPool.set(bestMatch.userId, matchUser);
      
      // Create active match record
      activeMatches.set(matchId, {
        users: [userId, bestMatch.userId],
        acceptances: {
          [userId]: false,
          [bestMatch.userId]: false
        },
        sharedInterests: bestMatch.sharedInterests,
        createdAt: new Date()
      });
      
      console.log(`Created active match with ID: ${matchId}`);
      
      // Get sockets for both users
      const user1Socket = socket;
      const user2Socket = ioInstance.sockets.sockets.get(bestMatch.socketId);
      
      if (!user2Socket) {
        console.log(`Could not find socket for user ${bestMatch.userId}. Aborting match.`);
        
        // Put the first user back in pool
        matchmakingPool.set(userId, {
          userId,
          socketId: socket.id,
          user: socket.user,
          interests: userInterests,
          joinedAt: new Date(),
          isBeingProcessed: false
        });
        
        // Clean up match data
        activeMatches.delete(matchId);
        return;
      }
      
      // Remove both users from matchmaking pool
      matchmakingPool.delete(userId);
      matchmakingPool.delete(bestMatch.userId);
      
      // Notify both users
      const createdMatchId = notifyMatchFound(user1Socket.user, user2Socket.user, bestMatch.sharedInterests);
      
      // Use the returned match ID for the timeout to ensure consistency
      console.log(`Using match ID for timeout: ${createdMatchId}`);
      
      // Set timeout for match acceptance
      const timeoutId = setTimeout(() => {
        // Check if match still exists and hasn't been fully accepted
        if (activeMatches.has(createdMatchId)) {
          const matchData = activeMatches.get(createdMatchId);
          const bothAccepted = Object.values(matchData.acceptances).every(status => status === true);
          
          if (!bothAccepted) {
            console.log(`Match ${createdMatchId} timed out`);
            
            // Notify both users
            matchData.users.forEach(userId => {
              const socketId = connectedUsers.get(userId);
              if (socketId) {
                ioInstance.to(socketId).emit('match:timeout', {
                  matchId: createdMatchId,
                  message: 'Match timed out due to no response'
                });
                
                // Add user back to matchmaking pool
                const userSocket = ioInstance.sockets.sockets.get(socketId);
                if (userSocket) {
                  matchmakingPool.set(userId, {
                    userId,
                    socketId,
                    user: userSocket.user,
                    interests: userSocket.user.interests,
                    joinedAt: new Date(),
                    isBeingProcessed: false
                  });
                  
                  // Find new match
                  setTimeout(() => {
                    ioInstance.to(socketId).emit('match:waiting', { message: 'Searching for a new match...' });
                    findMatchForUser(userSocket);
                  }, 1000);
                }
              }
            });
            
            // Clean up the match
            activeMatches.delete(createdMatchId);
          }
        }
      }, MATCH_ACCEPTANCE_TIMEOUT);
      
      // Store timeout IDs for both users
      userTimeouts.set(userId, timeoutId);
      userTimeouts.set(bestMatch.userId, timeoutId);
    } else {
      console.log(`No suitable real user matches found for user ${userId}. Creating AI bot match.`);
      
      // Generate a bot profile with matching gender and preference
      const userGender = socket.user.gender?.toLowerCase() || 'male';
      const userPreference = socket.user.preference || 'Friendship';
      
      // Select appropriate gender for the bot based on user's gender and preference
      let botGender;
      if (userPreference === 'Dating') {
        // For dating, select appropriate gender based on user's gender
        if (['male', 'female'].includes(userGender)) {
          // For heterosexual matching
          botGender = userGender === 'male' ? 'female' : 'male';
        } else {
          // For LGBTQ+ matching (generate a bot with same gender category)
          botGender = userGender;
        }
      } else {
        // For friendship, can be any gender but respect LGBTQ+ specific matching
        const lgbtqGenderCategories = [
          'transgender', 'trans', 'non-binary', 'nonbinary', 'genderqueer', 
          'genderfluid', 'agender', 'bigender', 'two-spirit', 'third-gender',
          'queer', 'questioning', 'intersex', 'other'
        ];
        
        const isUserLgbtq = lgbtqGenderCategories.includes(userGender);
        
        if (isUserLgbtq) {
          // LGBTQ+ users for friendship get matched with LGBTQ+ bots
          botGender = lgbtqGenderCategories[Math.floor(Math.random() * lgbtqGenderCategories.length)];
        } else {
          // Non-LGBTQ+ users can get any gender for friendship
          const genders = ['male', 'female'];
          botGender = genders[Math.floor(Math.random() * genders.length)];
        }
      }
      
      try {
        console.log(`[MATCH DEBUG] Generating bot profile with gender ${botGender} for user ${userId} with preference ${userPreference}`);
        
        // Generate a bot profile matching user's preferences
        const botProfile = await generateBotProfile(
          botGender, 
          userPreference, 
          socket.user.interests || []
        );
        
        if (!botProfile || !botProfile.id) {
          throw new Error('Failed to generate valid bot profile');
        }
        
        console.log(`[MATCH DEBUG] Successfully generated bot profile with ID ${botProfile.id} (${botProfile.username})`);
        
        // Verify bot exists in the database before proceeding
        const botExists = await verifyBotExists(botProfile.id);
        
        if (!botExists) {
          console.error(`[MATCH DEBUG] Bot ${botProfile.id} does not exist in database after creation`);
          throw new Error(`Bot ${botProfile.id} does not exist in database after creation`);
        }
        
        console.log(`[MATCH DEBUG] Verified bot ${botProfile.id} exists in database`);
        
        // Generate a matchId and create the match
        const matchId = uuidv4();
        console.log(`[MATCH DEBUG] Generated match ID ${matchId} for bot match`);
        
        // Store bot match data for response handling
        botMatches.set(matchId, {
          matchId,
          userId: socket.user.id,
          botProfile,
          preference: userPreference,
          messages: [],
          createdAt: new Date()
        });
        
        // Format bot as a user to fit into the existing flow
        const botAsUser = {
          id: botProfile.id,
          username: botProfile.username,
          first_name: botProfile.firstName,
          last_name: botProfile.lastName,
          gender: botProfile.gender,
          bio: botProfile.bio,
          date_of_birth: botProfile.date_of_birth,
          profile_picture_url: botProfile.profile_picture_url,
          interests: botProfile.interests,
          preference: userPreference
        };
        
        // Create shared interests based on user's interests and bot's interests
        const sharedInterests = socket.user.interests 
          ? socket.user.interests.filter(interest => botProfile.interests.includes(interest))
          : [];
        
        // Ensure at least one shared interest
        if (sharedInterests.length === 0 && botProfile.interests.length > 0) {
          sharedInterests.push(botProfile.interests[0]);
        }
        
        // Add to active matches
        activeMatches.set(matchId, {
          id: matchId,
          users: [userId, botProfile.id],
          acceptances: {
            [userId]: false,
            [botProfile.id]: true // Bot automatically accepts
          },
          sharedInterests,
          preference: userPreference,
          createdAt: new Date(),
          isBot: true
        });
        
        // Remove user from matchmaking pool
        matchmakingPool.delete(userId);
        
        // Reset processing flag
        userPoolData.isBeingProcessed = false;
        
        // Create match in database
        try {
          // Create match record in database
          console.log(`[MATCH DEBUG] Creating match record in database between user ${userId} and bot ${botProfile.id}`);
          const result = await createMatchInDatabase(matchId, userId, botProfile.id);
          
          if (!result || !result.success) {
            console.error(`[MATCH DEBUG] Failed to create match in database: ${result?.error?.message || 'Unknown error'}`);
            throw new Error(result?.error?.message || 'Failed to create match in database');
          }
          
          console.log(`[MATCH DEBUG] Successfully created match record in database with ID ${matchId}`);
          
          // Notify user of the match
          const userMatchData = createMatchData(botAsUser, sharedInterests, matchId, userPreference);
          socket.emit('match:found', { match: userMatchData });
          
          console.log(`[MATCH DEBUG] Notified user ${userId} about match with bot ${botProfile.id}`);
          
          // Clear user timeout
          clearMatchmakingTimeouts(userId);
          
          // Set timeout for match acceptance (even though bot auto-accepts)
          const timeoutId = setTimeout(() => {
            // Check if match still exists and hasn't been accepted by the user
            if (activeMatches.has(matchId)) {
              const matchData = activeMatches.get(matchId);
              const userAccepted = matchData.acceptances[userId];
              
              if (!userAccepted) {
                console.log(`[MATCH DEBUG] Bot match ${matchId} timed out due to no user response`);
                
                // Notify user
                const socketId = connectedUsers.get(userId);
                if (socketId) {
                  ioInstance.to(socketId).emit('match:timeout', {
                    matchId,
                    message: 'Match timed out due to no response'
                  });
                }
                
                // Clean up
                activeMatches.delete(matchId);
                botMatches.delete(matchId);
              }
            }
          }, MATCH_ACCEPTANCE_TIMEOUT);
          
          userTimeouts.set(userId, timeoutId);
          
        } catch (dbError) {
          console.error(`[MATCH DEBUG] Error creating bot match in database: ${dbError.message}`);
          
          // If we can't create the match, abort and try again with a real user
          activeMatches.delete(matchId);
          botMatches.delete(matchId);
          
          // Put user back in pool
          userPoolData.isBeingProcessed = false;
          matchmakingPool.set(userId, userPoolData);
          
          // Notify user
          socket.emit('match:notFound', { 
            message: 'We encountered an issue creating your match. Please try again.' 
          });
          
          return;
        }
      } catch (error) {
        console.error(`[MATCH DEBUG] Error creating bot match: ${error.message}`);
        console.error(error.stack);
        
        // Fallback to standard behavior
        socket.emit('match:notFound', { message: 'No suitable matches found at this time. Please try again later.' });
        
        // Reset processing flag but keep in matchmaking pool
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
        
        // Set a timeout to try again after delay
        const timeoutId = setTimeout(() => {
          if (connectedUsers.has(userId) && matchmakingPool.has(userId)) {
            console.log(`[MATCH DEBUG] Retrying match for user ${userId}`);
            socket.emit('match:waiting', { message: 'Searching for a match...' });
            findMatchForUser(socket);
          }
        }, 10000); // Try again in 10 seconds
        
        userTimeouts.set(userId, timeoutId);
      }
    }
  } catch (error) {
    console.error('Error finding match:', error);
    socket.emit('error', { 
      source: 'findRandomMatch',
      message: 'Server error finding a match' 
    });
    
    // If user exists in pool, reset processing flag
    const userId = socket.user.id;
    if (matchmakingPool.has(userId)) {
      const userPoolData = matchmakingPool.get(userId);
      userPoolData.isBeingProcessed = false;
      matchmakingPool.set(userId, userPoolData);
    }
  }
};

// Handle message deletion notifications
const notifyMessageDeletion = (messageId, senderId, receiverId) => {
  try {
    // Notify the sender (if they are online)
    const senderSocketId = connectedUsers.get(senderId);
    if (senderSocketId) {
      ioInstance.to(senderSocketId).emit('message:delete', {
        messageId,
        deletedAt: new Date().toISOString()
      });
    }
    
    // Notify the receiver (if they are online)
    const receiverSocketId = connectedUsers.get(receiverId);
    if (receiverSocketId) {
      ioInstance.to(receiverSocketId).emit('message:delete', {
        messageId,
        deletedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in notifyMessageDeletion:', error);
  }
};

// Handle bulk message deletion notifications
const notifyBulkMessageDeletion = (messageIds, user1Id, user2Id) => {
  try {
    const deletedAt = new Date().toISOString();
    
    // Notify first user (if online)
    const user1SocketId = connectedUsers.get(user1Id);
    if (user1SocketId) {
      ioInstance.to(user1SocketId).emit('message:bulkDelete', {
        messageIds,
        otherUserId: user2Id,
        deletedAt
      });
    }
    
    // Notify second user (if online)
    const user2SocketId = connectedUsers.get(user2Id);
    if (user2SocketId) {
      ioInstance.to(user2SocketId).emit('message:bulkDelete', {
        messageIds,
        otherUserId: user1Id,
        deletedAt
      });
    }
  } catch (error) {
    console.error('Error in notifyBulkMessageDeletion:', error);
  }
};

/**
 * Notify users when a conversation has been deleted
 * @param {string} currentUserId - ID of the user who deleted the conversation
 * @param {string} otherUserId - ID of the other user in the conversation
 */
const notifyConversationDeleted = (currentUserId, otherUserId) => {
  try {
    const timestamp = new Date().toISOString();
    console.log(`Notifying conversation deletion between ${currentUserId} and ${otherUserId}`);
    
    // Notify the user who initiated the deletion (confirmation)
    const senderSocketId = connectedUsers.get(currentUserId);
    if (senderSocketId) {
      ioInstance.to(senderSocketId).emit('conversation:deleted', {
        receiverId: otherUserId,
        senderId: currentUserId,
        timestamp,
        status: 'success',
        message: 'Conversation deleted successfully'
      });
      console.log(`Sent confirmation to user ${currentUserId}`);
    }
    
    // Notify the other user that the conversation was deleted
    const receiverSocketId = connectedUsers.get(otherUserId);
    if (receiverSocketId) {
      ioInstance.to(receiverSocketId).emit('conversation:deleted', {
        receiverId: otherUserId,
        senderId: currentUserId,
        timestamp,
        message: 'The other user has deleted this conversation'
      });
      console.log(`Sent notification to user ${otherUserId}`);
    }
  } catch (error) {
    console.error('Error in notifyConversationDeleted:', error);
  }
};

/**
 * Clean up any active matches and conversations for a disconnected user
 * @param {string} userId - ID of the disconnected user
 */
const cleanupUserMatches = (userId) => {
  try {
    // Remove user from matchmaking pool
    if (matchmakingPool.has(userId)) {
      matchmakingPool.delete(userId);
      info(`Removed disconnected user ${userId} from matchmaking pool`);
    }
    
    // Clean up any active matches
    for (const [matchId, matchData] of activeMatches.entries()) {
      if (matchData.users.includes(userId)) {
        // Notify other user in the match
        const otherUserId = matchData.users.find(id => id !== userId);
        if (otherUserId) {
          const otherUserSocketId = connectedUsers.get(otherUserId);
          if (otherUserSocketId) {
            ioInstance.to(otherUserSocketId).emit('match:userLeft', {
              matchId,
              userId,
              reason: 'disconnected'
            });
          }
        }
      }
    }
  } catch (error) {
    error(`Error cleaning up matches for user ${userId}: ${error.message}`);
  }
};

// Export essential functions
module.exports = {
  initializeSocket,
  notifyMessageDeletion,
  notifyBulkMessageDeletion,
  notifyConversationDeleted,
  connectedUsers,
  activeMatches,
  ioInstance,
  createMatchInDatabase,
  updateUserOnlineStatus
};

/**
 * CLIENT IMPLEMENTATION GUIDANCE
 * 
 * To implement reliable messaging like Instagram, your front-end should:
 * 
 * 1. Always initialize conversations before sending messages or typing indicators:
 *    - Emit 'conversation:init' with { userId: otherPersonId }
 *    - Listen for 'conversation:ready' before enabling typing/messaging
 * 
 * 2. Handle reconnections automatically:
 *    - Listen for 'disconnect' events and initiate reconnection
 *    - After reconnection, emit 'client:reconnected' to restore status
 *    - Re-initialize active conversations
 * 
 * 3. For typing indicators:
 *    - Only emit 'typing:start' when user starts typing, throttle calls (1 per second max)
 *    - Emit 'typing:stop' when user explicitly stops typing or message is sent
 *    - Trust the server's auto-timeout after 5 seconds of inactivity
 * 
 * 4. Maintain heartbeat:
 *    - Listen for 'heartbeat' events from server and respond to 'ping' events
 *    - Implement exponential backoff for reconnection attempts on disconnect
 *    - If disconnected for more than 1 minute, fetch messages since last received
 * 
 * 5. Enable all chat features from the start:
 *    - Typing indicators
 *    - Message delivery status
 *    - Read receipts
 *    - Message reactions
 * 
 * 6. Sample reconnection implementation:
 *    ```javascript
 *    let reconnectAttempts = 0;
 *    socket.on('disconnect', () => {
 *      const timeout = Math.min(1000 * (2 ** reconnectAttempts), 30000);
 *      setTimeout(() => {
 *        socket.connect();
 *        reconnectAttempts++;
 *      }, timeout);
 *    });
 *    
 *    socket.on('connect', () => {
 *      reconnectAttempts = 0;
 *      socket.emit('client:reconnected');
 *      
 *      // Re-initialize active conversations
 *      activeConversations.forEach(userId => {
 *        socket.emit('conversation:init', { userId });
 *      });
 *    });
 *    ```
 */ 

/**
 * Handle bot responses to user messages
 * @param {string} matchId - Match ID
 * @param {string} userMessage - Message from user
 * @param {object} userSocket - User's socket
 */
const handleBotResponse = async (matchId, userMessage, userSocket) => {
  try {
    console.log(`[BOT DEBUG] Starting bot response handler for match ${matchId}`);
    
    // Get the bot match data
    const botMatch = botMatches.get(matchId);
    if (!botMatch) {
      console.error(`[BOT DEBUG] No bot match found for matchId: ${matchId}`);
      return;
    }
    
    const { botProfile, userId } = botMatch;
    console.log(`[BOT DEBUG] Bot match found. Bot: ${botProfile.id}, User: ${userId}`);
    
    // Add user message to match history for context
    if (!matchMessageHistory.has(matchId)) {
      matchMessageHistory.set(matchId, []);
    }
    
    const history = matchMessageHistory.get(matchId);
    history.push({ role: 'user', content: userMessage });
    
    // Keep only the last 10 messages for context
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    // Get user socket if it wasn't provided
    let socket = userSocket;
    if (!socket) {
      const userSocketId = connectedUsers.get(userId);
      if (!userSocketId) {
        console.error(`[BOT DEBUG] No socket found for user ${userId}`);
        return;
      }
      socket = ioInstance.sockets.sockets.get(userSocketId);
      if (!socket) {
        console.error(`[BOT DEBUG] Could not get socket for user ${userId} with socketId ${userSocketId}`);
        return;
      }
    }
    
    // Check if socket is valid and has emit function
    if (!socket || typeof socket.emit !== 'function') {
      console.error(`[BOT DEBUG] Invalid socket object for user ${userId}. Socket exists: ${!!socket}`);
      return;
    } else {
      console.log(`[BOT DEBUG] Valid socket found for user ${userId}`);
    }
    
    // Send an immediate simple response to ensure user gets something
    const immediateResponse = {
      id: uuidv4(),
      senderId: botProfile.id,
      senderName: botProfile.username || botProfile.first_name,
      message: "I'm thinking...",
      timestamp: new Date().toISOString(),
      isTyping: true
    };
    
    console.log(`[BOT DEBUG] Sending immediate response to user ${userId}`);
    socket.emit('match:message', immediateResponse);
    
    // Wait a short time to simulate typing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Prepare a fallback response in case AI generation fails
    const fallbackResponses = [
      "That's interesting! Tell me more about it.",
      "I understand. What else is on your mind?",
      "I'd love to hear more about that.",
      "Interesting perspective! I appreciate you sharing that with me.",
      "Thanks for sharing that with me. How has your day been going?",
      "I see what you mean. What else would you like to talk about?"
    ];
    
    let botMessage = "";
    
    try {
      // Prepare prompt for AI
      const prompt = `You are ${botProfile.first_name}, a ${botProfile.age}-year-old ${botProfile.gender} from ${botProfile.city || 'the area'}. 
      Your interests include ${botProfile.interests.join(', ')}. 
      Your education background is ${botProfile.education || 'not specified'} and your occupation is ${botProfile.occupation || 'not specified'}.
      
      You are having a chat conversation with a user. Respond naturally as if you were a real person using casual, friendly language.
      Keep your response fairly brief (1-3 sentences) and conversational. Do not use hashtags or emojis.
      
      Respond to this message from the user: "${userMessage}"`;
      
      // Try to generate AI response
      if (typeof model !== 'undefined') {
        console.log(`[BOT DEBUG] Generating AI response using model`);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        botMessage = response.text().trim();
        console.log(`[BOT DEBUG] Generated AI response: "${botMessage.substring(0, 30)}..."`);
      } else {
        console.error(`[BOT DEBUG] AI model not available, using fallback`);
        throw new Error('AI model not available');
      }
    } catch (aiError) {
      console.error(`[BOT DEBUG] Error generating AI content: ${aiError.message}`);
      // Use fallback response if AI generation fails
      botMessage = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
      console.log(`[BOT DEBUG] Using fallback response: "${botMessage}"`);
    }
    
    // Ensure we have a message to send
    if (!botMessage || botMessage.trim() === '') {
      botMessage = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
      console.log(`[BOT DEBUG] Empty response from AI, using fallback: "${botMessage}"`);
    }
    
    // Prepare bot response
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const botResponseObject = {
      id: messageId,
      senderId: botProfile.id,
      senderName: botProfile.username || botProfile.first_name,
      message: botMessage,
      timestamp,
      isBot: true
    };
    
    // Save bot message to history
    history.push({ role: 'assistant', content: botMessage });
    
    // Send bot response to user
    console.log(`[BOT DEBUG] Sending bot response to user ${userId}`);
    socket.emit('match:message', botResponseObject);
    
    // Save message to database (fire and forget)
    try {
      console.log(`[BOT DEBUG] Saving bot message to database`);
      const { error: dbError } = await supabase
        .from('messages')
        .insert({
          id: messageId,
          sender_id: botProfile.id,
          receiver_id: userId,
          content: botMessage,
          is_read: false,
          created_at: timestamp,
          updated_at: timestamp
        });
      
      if (dbError) {
        console.error(`[BOT DEBUG] Database error saving bot message: ${dbError.message}`);
      } else {
        console.log(`[BOT DEBUG] Bot message saved to database`);
      }
    } catch (dbError) {
      console.error(`[BOT DEBUG] Error saving bot message to database: ${dbError.message}`);
      // Don't block the flow if database save fails
    }
    
    console.log(`[BOT DEBUG] Bot response completed for match ${matchId}`);
  } catch (error) {
    console.error(`[BOT DEBUG] Critical error in handleBotResponse: ${error.message}`);
    console.error(error.stack);
  }
}