const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { info, error, warn } = require('../utils/logger');

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
const { generateBotProfile, generateBotResponse, storeBotMessage, verifyAndRecoverBotUser, createBotUserRecord } = require('../services/ai/botProfileService');

// Track bot matches and their data
const botMatches = new Map();

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
 * @param {boolean} shouldForceBotMatches - Whether to force bot matches for users without matches
 */
const findMatchesForAllUsers = (shouldForceBotMatches = false) => {
  // Clean up the pool first to ensure all users are valid
  cleanMatchmakingPool();
  
  // Skip all processing if the pool is empty
  const poolSize = matchmakingPool.size;
  if (poolSize === 0) {
    // No users in pool, nothing to do
    return;
  }
  
  // For normal (non-forced) matching, require at least 2 users
  if (poolSize < 2 && !shouldForceBotMatches) {
    // Only log this once every 12 checks (once per minute) to reduce spam
    // Using a timestamp-based approach to avoid needing to store state
    const now = Date.now();
    if (now % (MATCHMAKING_INTERVAL * 12) < MATCHMAKING_INTERVAL) {
      info(`Not enough users in matchmaking pool (${poolSize}). Need at least 2 users.`);
    }
    return;
  }
  
  // If we should force bot matches and have at least one user, log this
  if (shouldForceBotMatches && poolSize > 0) {
    info(`Running matchmaking with forced bot matches for ${poolSize} users in pool`);
  } else {
    info(`Running global matchmaking for ${poolSize} users in pool`);
  }
  
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
    
    // Find a match or create a bot match if forced
    findMatchForUser(socket, shouldForceBotMatches);
    
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
  
  // Initialize a counter to track iterations
  let iterationCount = 0;
  
  matchmakingIntervalId = setInterval(() => {
    // Increment counter each time matchmaking runs
    iterationCount++;
    
    // Every 12 iterations (approximately every minute), check if we should force bot matches
    const shouldForceBotMatches = iterationCount >= 12;
    
    // Run matchmaking with option to force bot matches
    findMatchesForAllUsers(shouldForceBotMatches);
    
    // Reset counter after forcing bot matches
    if (shouldForceBotMatches) {
      info('Running forced bot matches after one minute of matchmaking');
      iterationCount = 0;
    }
  }, MATCHMAKING_INTERVAL);
  
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
  // Store IO instance for global access
  ioInstance = io;
  
  // Set up rate limiting for connections
  io.use((socket, next) => {
    try {
      const address = socket.handshake.address;
      const now = Date.now();
      
      // Track connections per IP address
      if (!connectionRateLimit.has(address)) {
        connectionRateLimit.set(address, {
          count: 1,
          firstConnection: now,
          lastConnection: now
        });
      } else {
        const rateData = connectionRateLimit.get(address);
        rateData.count++;
        rateData.lastConnection = now;
        
        // Check rate limit: max 10 connections per minute per IP
        const timeWindow = 60 * 1000; // 1 minute
        if (rateData.count > 10 && (now - rateData.firstConnection) < timeWindow) {
          error(`Rate limit exceeded for ${address}: ${rateData.count} connections in less than a minute`);
          return next(new Error('Connection rate limit exceeded. Please try again later.'));
        }
        
        // Reset counter if time window has passed
        if (now - rateData.firstConnection > timeWindow) {
          rateData.count = 1;
          rateData.firstConnection = now;
        }
        
        connectionRateLimit.set(address, rateData);
      }
      
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
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });

  // Log important client events for developers
  console.log(`
=== SOCKET.IO SERVER INITIALIZED ===
Important socket events for client integration:

1. 'chat:open' - Clients MUST emit this event when a user opens a chat
   - Required data: { matchId: 'match-uuid' }
   - This ensures bots respond when chats are opened, even if no message is sent
   - Example: socket.emit('chat:open', { matchId: matchId });

2. 'match:message' - Used for sending messages in a match
   - Required data: { matchId: 'match-uuid', message: 'user message' }

3. 'match:typing' - Used for typing indicators
   - Required data: { matchId: 'match-uuid', typing: true/false }

Bot chat interactions require 'chat:open' to be emitted when a user opens a chat.
===========================================
`);
  
  // Initialize socket handlers
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id} (${socket.user.username})`);
    
    // Add user to connected users map
    connectedUsers.set(socket.user.id, socket.id);
    
    // Update user's online status in database immediately
    updateUserOnlineStatus(socket.user.id, true);
    
    // Cancel any pending disconnection timeout for this user
    if (global.disconnectTimeouts && global.disconnectTimeouts.has(socket.user.id)) {
      clearTimeout(global.disconnectTimeouts.get(socket.user.id));
      global.disconnectTimeouts.delete(socket.user.id);
    }
    
    // Notify other users that this user is online
    socket.broadcast.emit('user:status', {
      userId: socket.user.id,
      online: true,
      lastSeen: new Date().toISOString()
    });
    
    // Initialize socket's active conversations
    socket.activeConversations = new Set();
    
    // Initialize message sequence counter
    socket.messageSequence = 0;
    
    // Initialize pending messages map
    socket.pendingMessages = new Map();
    
    // Initialize connection stability monitoring
    socket.connectionStability = {
      lastMessageTime: Date.now(),
      messagesSinceReconnect: 0,
      lastPingResponse: Date.now(),
      connectionHealth: 100, // 0-100 scale
      missedPings: 0,
      lastActivityTime: Date.now()
    };
    
    // Add connection stability monitoring
    const monitorInterval = setInterval(() => {
      try {
        const now = Date.now();
        
        // Check if connection is healthy
        if (socket.connectionStability) {
          // Check message frequency
          const timeSinceLastMessage = now - socket.connectionStability.lastMessageTime;
          
          // If we've sent messages but haven't had activity in a while, check connection
          if (socket.connectionStability.messagesSinceReconnect > 0 && 
              timeSinceLastMessage > 30000) { // 30 seconds
            
            // Send ping to check connection
            socket.emit('ping:check', { time: now }, (response) => {
              if (response) {
                socket.connectionStability.lastPingResponse = now;
                socket.connectionStability.missedPings = 0;
                socket.connectionStability.connectionHealth = Math.min(100, 
                  socket.connectionStability.connectionHealth + 10);
              }
            });
            
            // If no ping response for a while, connection might be unhealthy
            const timeSinceLastPing = now - socket.connectionStability.lastPingResponse;
            if (timeSinceLastPing > 45000) { // 45 seconds
              socket.connectionStability.missedPings++;
              socket.connectionStability.connectionHealth = Math.max(0, 
                socket.connectionStability.connectionHealth - 20);
              
              // If health is critically low, attempt reconnection
              if (socket.connectionStability.connectionHealth < 30) {
                console.log(`Connection health critical for ${socket.user.id}, attempting reconnect`);
                socket.emit('connection:refresh');
                
                // Reset health after reconnect attempt
                socket.connectionStability.connectionHealth = 60;
                
                // Resend any pending messages
                if (socket.pendingMessages && socket.pendingMessages.size > 0) {
                  console.log(`Resending ${socket.pendingMessages.size} pending messages for ${socket.user.id}`);
                  
                  // Wait a short delay for connection to stabilize
                  setTimeout(() => {
                    // Sort by sequence for ordered delivery
                    const pendingArray = Array.from(socket.pendingMessages.entries())
                      .sort((a, b) => a[1].sequence - b[1].sequence);
                    
                    // Resend each pending message
                    for (const [tempId, msgData] of pendingArray) {
                      socket.emit('message:resend', {
                        tempId,
                        receiverId: msgData.receiverId,
                        content: msgData.content,
                        mediaUrl: msgData.mediaUrl || null,
                        sequence: msgData.sequence
                      });
                    }
                  }, 1000);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error in connection monitor for ${socket.user?.id}:`, err);
      }
    }, 15000); // Check every 15 seconds
    
    // Clear interval on disconnect
    socket.on('disconnect', () => {
      clearInterval(monitorInterval);
    });
    
    // Add ping response handler
    socket.on('ping:response', (data) => {
      socket.connectionStability.lastPingResponse = Date.now();
      socket.connectionStability.missedPings = 0;
      socket.connectionStability.connectionHealth = Math.min(100, 
        socket.connectionStability.connectionHealth + 10);
    });
    
    // Handle message resend requests from client
    socket.on('message:resendRequest', async (data) => {
      try {
        const { conversationId, lastMessageId, limit = 10 } = data;
        const userId = socket.user.id;
        
        // Query for messages after the last received one
        let query = supabase.from('messages')
          .select('*')
          .or(`and(sender_id.eq.${userId},receiver_id.eq.${conversationId}),and(sender_id.eq.${conversationId},receiver_id.eq.${userId})`)
          .order('created_at', { ascending: false })
          .limit(limit);
          
        // If a specific message ID was provided, get messages after it
        if (lastMessageId) {
          // Get the message timestamp first
          const { data: lastMessage } = await supabase
            .from('messages')
            .select('created_at')
            .eq('id', lastMessageId)
            .single();
            
          if (lastMessage) {
            query = query.gt('created_at', lastMessage.created_at);
          }
        }
        
        const { data: messages, error } = await query;
        
        if (error) {
          console.error('Error fetching missed messages:', error);
          return;
        }
        
        // Send missed messages back to client
        if (messages && messages.length > 0) {
          socket.emit('message:missedBatch', {
            messages,
            conversationId
          });
        }
      } catch (err) {
        console.error('Error handling resend request:', err);
      }
    });
    
    // Track client-side reconnection attempts
    socket.on('client:reconnect', () => {
      // Re-establish connection information
      connectedUsers.set(socket.user.id, socket.id);
      updateUserOnlineStatus(socket.user.id, true);
      
      // Cancel any pending disconnection timeout for this user
      if (global.disconnectTimeouts && global.disconnectTimeouts.has(socket.user.id)) {
        clearTimeout(global.disconnectTimeouts.get(socket.user.id));
        global.disconnectTimeouts.delete(socket.user.id);
      }
      
      // Notify other users that this user is online
      socket.broadcast.emit('user:status', {
        userId: socket.user.id,
        online: true,
        lastSeen: new Date().toISOString()
      });
      
      // Re-initialize active conversations
      if (socket.activeConversations && socket.activeConversations.size > 0) {
        socket.activeConversations.forEach(userId => {
          socket.emit('conversation:active', { userId });
        });
      }
      
      // Reset connection stability metrics
      if (socket.connectionStability) {
        socket.connectionStability.lastMessageTime = Date.now();
        socket.connectionStability.messagesSinceReconnect = 0;
        socket.connectionStability.lastPingResponse = Date.now();
        socket.connectionStability.connectionHealth = 100;
        socket.connectionStability.missedPings = 0;
      }
    });
    
    // NEW: Handle conversation initialization to ensure typing indicators work
    // before the first message is sent
    socket.on('conversation:init', async (data) => {
      try {
        const { userId } = data;
        if (!userId) return;
        
        // Add this user to active conversations
        if (!socket.activeConversations) {
          socket.activeConversations = new Set();
        }
        socket.activeConversations.add(userId);
        
        // Fetch any existing conversation
        const { data: messages, error } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${socket.user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${socket.user.id})`)
          .order('created_at', { ascending: false })
          .limit(1);
        
        // If no messages exist yet, we need to pre-initialize for typing indicators
        // This solves the issue with typing indicators not working before the first message
        if (!messages || messages.length === 0) {
          // Notify the other user that this user has started a conversation
          const receiverSocketId = connectedUsers.get(userId);
          if (receiverSocketId) {
            const receiverSocket = io.sockets.sockets.get(receiverSocketId);
            if (receiverSocket) {
              // Add to the receiver's active conversations as well
              if (!receiverSocket.activeConversations) {
                receiverSocket.activeConversations = new Set();
              }
              receiverSocket.activeConversations.add(socket.user.id);
              
              // Alert the receiver that a conversation has been initialized
              receiverSocket.emit('conversation:init', {
                userId: socket.user.id,
                username: socket.user.username,
                profilePictureUrl: socket.user.profile_picture_url
              });
            }
          }
        }
        
        // Acknowledge successful initialization
        socket.emit('conversation:ready', { userId });
      } catch (error) {
        console.error('Error initializing conversation:', error);
        socket.emit('error', {
          source: 'conversation',
          message: 'Failed to initialize conversation'
        });
      }
    });
    
    // Emit online status to other users
    io.emit('user:status', {
      userId: socket.user.id,
      online: true
    });
    
    // Handle private messages
    socket.on('message:send', async (data, callback) => {
      try {
        const { receiverId, content, mediaUrl } = data;
        const senderId = socket.user.id;
        
        // Validate required fields
        if (!receiverId || !content) {
          const error = { message: 'Receiver ID and content are required' };
          socket.emit('error', error);
          if (typeof callback === 'function') callback({ success: false, error });
          return;
        }
        
        // Create ordered message sequence tracking
        if (!socket.messageSequence) {
          socket.messageSequence = 0;
        }
        const currentSequence = ++socket.messageSequence;
        
        // Add to active conversations if not already added
        if (!socket.activeConversations) {
          socket.activeConversations = new Set();
        }
        socket.activeConversations.add(receiverId);
        
        // Store pending messages to prevent loss on connection issues
        if (!socket.pendingMessages) {
          socket.pendingMessages = new Map();
        }
        
        // Generate a temporary ID for the message until confirmed by server
        const tempMessageId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        // Store in pending messages
        socket.pendingMessages.set(tempMessageId, {
          receiverId,
          content,
          mediaUrl,
          createdAt: new Date(),
          sequence: currentSequence
        });
        
        // Add a timeout for database operations to avoid hanging
        const dbTimeout = setTimeout(() => {
          const timeoutError = { message: 'Database operation timed out' };
          socket.emit('error', timeoutError);
          if (typeof callback === 'function') callback({ success: false, error: timeoutError });
        }, 8000); // 8 second timeout
        
        // Create message in database
        try {
        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            content,
            media_url: mediaUrl || null,
            is_read: false,
            created_at: new Date(),
              updated_at: new Date(),
              sequence: currentSequence // Store sequence for ordering
          })
          .select()
          .single();
        
          // Clear the timeout since we got a response
          clearTimeout(dbTimeout);
          
          // Remove from pending messages
          socket.pendingMessages.delete(tempMessageId);
        
        if (error) {
          console.error('Error creating message:', error);
            const dbError = { message: 'Failed to send message', details: error.message };
            socket.emit('error', dbError);
            if (typeof callback === 'function') callback({ success: false, error: dbError });
          return;
        }
        
        // Add sender info to the message object
        message.sender = {
          id: socket.user.id,
            username: socket.user.username,
          firstName: socket.user.first_name,
          lastName: socket.user.last_name,
          profilePictureUrl: socket.user.profile_picture_url
        };
        
          // Forward the message to the recipient if they are online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
            const receiverSocket = io.sockets.sockets.get(receiverSocketId);
            if (receiverSocket) {
              // Add to receiver's active conversations
              if (!receiverSocket.activeConversations) {
                receiverSocket.activeConversations = new Set();
              }
              receiverSocket.activeConversations.add(senderId);

              // Emit message:received event to recipient with complete message data
              receiverSocket.emit('message:received', {
                id: message.id,
                messageId: message.id, // Add duplicate for compatibility
                senderId: senderId,
                sender_id: senderId, // Add duplicate for compatibility
                senderName: socket.user.username || `${socket.user.first_name} ${socket.user.last_name}`,
                receiverId: receiverId,
                receiver_id: receiverId, // Add duplicate for compatibility
                content: content,
                message: content, // Add duplicate for compatibility
                mediaUrl: mediaUrl,
                media_url: mediaUrl, // Add duplicate for compatibility
                timestamp: message.created_at,
                created_at: message.created_at, // Add duplicate for compatibility
                isRead: false,
                is_read: false, // Add duplicate for compatibility
                profilePic: socket.user.profile_picture_url,
                profilePictureUrl: socket.user.profile_picture_url,
                sender: {
                  id: socket.user.id,
                  username: socket.user.username,
                  firstName: socket.user.first_name,
                  lastName: socket.user.last_name,
                  profilePictureUrl: socket.user.profile_picture_url
                }
              });
            }
          }
          
          // Acknowledge successful message delivery to sender
          if (typeof callback === 'function') {
            callback({ 
              success: true, 
              messageId: message.id, 
              sequence: currentSequence,
              timestamp: message.created_at
            });
          }
          
          // Update connection health metrics
          if (socket.connectionStability) {
            socket.connectionStability.lastMessageTime = Date.now();
            socket.connectionStability.messagesSinceReconnect++;
            socket.connectionStability.connectionHealth = Math.min(100, 
              socket.connectionStability.connectionHealth + 5);
          }
          
          // Process conversation streak
          try {
            const { processConversationStreak } = require('../services/achievement/streakService');
            const { checkMessageAchievements } = require('../services/achievement/achievementService');
            
            // Track streak for this conversation
            const streakInfo = await processConversationStreak(senderId, receiverId);
            if (streakInfo) {
              // Add streak info to message delivery data for both users
              if (receiverSocketId) {
                const receiverSocket = io.sockets.sockets.get(receiverSocketId);
                if (receiverSocket) {
                  receiverSocket.emit('conversation:streak', {
                    conversationId: streakInfo.conversation_id,
                    streakDays: streakInfo.streak_days,
                    expiresAt: streakInfo.expires_at
                  });
                }
              }
              
              socket.emit('conversation:streak', {
                conversationId: streakInfo.conversation_id,
                streakDays: streakInfo.streak_days,
                expiresAt: streakInfo.expires_at
              });
            }
            
            // Check for message achievements
            await checkMessageAchievements(senderId);
          } catch (achievementError) {
            console.error('Error processing achievements:', achievementError);
            // Non-blocking, don't fail the message send operation
          }
        } catch (dbError) {
          // Clear the timeout
          clearTimeout(dbTimeout);
          throw dbError; // Re-throw to be caught by outer try/catch
        }
      } catch (error) {
        console.error('Message send error:', error);
        const serverError = { message: 'Server error while sending message', details: error.message };
        socket.emit('error', serverError);
        if (typeof callback === 'function') callback({ success: false, error: serverError });
      }
    });
    
    // Handle messages in match rooms
    socket.on('match:message', async (data, callback) => {
      try {
        const { matchId, message } = data;
        const userId = socket.user.id;
        
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
          info(`User ${userId} auto-joined match room ${matchId}`);
        }
        
        // Get room members count for delivery status
        const room = io.sockets.adapter.rooms.get(matchId);
        const roomSize = room ? room.size : 1; // Count includes the sender
        const wasDelivered = roomSize > 1; // Delivered if more than just the sender
        
        // Save message to database
        try {
          // Get match data to determine the recipient
          let recipientId;
          
          // Check if this is a bot match
          if (botMatches.has(matchId)) {
            const botMatch = botMatches.get(matchId);
            recipientId = botMatch.botProfile.id;
            info(`This is a bot match. Bot ID: ${recipientId}, User ID: ${userId}`);
          } else if (activeMatches.has(matchId)) {
            // Regular user match
            const matchData = activeMatches.get(matchId);
            recipientId = matchData.users.find(id => id !== userId);
          } else {
            throw new Error(`Match ${matchId} not found in activeMatches or botMatches`);
          }
          
          // Insert message into database
          const { data: savedMessage, error: dbError } = await supabase
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
            throw new Error(`Database error: ${dbError.message}`);
          }
          
          info(`Saved message from ${userId} to ${recipientId} in database`);
        } catch (dbError) {
          error(`Error saving message to database: ${dbError.message}`);
          // Don't fail the operation, continue sending the message
        }
        
        // Emit the message to the match room
        socket.to(matchId).emit('match:message', messageObject);
        
        // Send confirmation to sender with delivery info
        socket.emit('match:messageSent', {
          ...messageObject,
          matchId,
          deliveryStatus: wasDelivered ? 'delivered' : 'sent',
          recipientCount: Math.max(0, roomSize - 1) // Number of recipients
        });
        
        // Check if this is a bot match and handle bot response
        if (botMatches.has(matchId)) {
          info(`Triggering bot response for match ${matchId} from user ${userId} with message: "${message}"`);
          
          // Update botMatch data to ensure it has the latest user ID
          const botMatch = botMatches.get(matchId);
          if (botMatch.userId !== userId) {
            info(`Updating bot match ${matchId} user ID from ${botMatch.userId} to ${userId}`);
            botMatch.userId = userId;
            botMatches.set(matchId, botMatch);
          }
          
          // Make sure user's socket ID is correctly mapped
          if (!connectedUsers.has(userId) || connectedUsers.get(userId) !== socket.id) {
            info(`Updating connectedUsers map for user ${userId} with socket ID ${socket.id}`);
            connectedUsers.set(userId, socket.id);
          }
          
          // Wait a moment before triggering the bot response (feels more natural)
          setTimeout(() => {
            handleBotResponse(matchId, message, socket);
          }, 500);
        }
        
        // Execute callback if provided
        if (typeof callback === 'function') {
          callback({ 
            success: true, 
            messageId,
            timestamp,
            deliveryStatus: wasDelivered ? 'delivered' : 'sent'
          });
        }
      } catch (error) {
        error(`Error handling match message: ${error.message}`);
        socket.emit('error', {
          source: 'match:message',
          message: 'Failed to process message' 
        });
        if (typeof callback === 'function') callback({ success: false, error: { message: error.message } });
      }
    });

    // Add reconnection handling
    socket.on('reconnect:check', async () => {
      try {
        const userId = socket.user.id;
        info(`Reconnection check for user ${userId}`);
        
        // Check if user is in any active matches
        const { data: userMatches, error: matchError } = await supabase
          .from('matches')
          .select('id, user1_id, user2_id, status')
          .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
          .eq('status', 'accepted');
          
        if (matchError) {
          error(`Error checking active matches for reconnecting user ${userId}: ${matchError.message}`);
          return;
        }
        
        // Rejoin all active match rooms
        if (userMatches && userMatches.length > 0) {
          for (const match of userMatches) {
            socket.join(match.id);
            info(`User ${userId} rejoined match room ${match.id} after reconnect`);
            
            // Notify the room that user has reconnected
            socket.to(match.id).emit('user:reconnected', {
              userId,
              username: socket.user.username,
              timestamp: new Date().toISOString()
            });
          }
          
          // Send the active matches back to the user
          socket.emit('reconnect:matches', { matches: userMatches });
        }
        
        // Update connection status
        updateUserOnlineStatus(userId, true);
        
        // Refresh connectedUsers map
        connectedUsers.set(userId, socket.id);
        
      } catch (err) {
        error(`Error handling reconnection for user ${socket.user.id}: ${err.message}`);
      }
    });

    // NEW ENHANCED MESSAGING FEATURES

    // Mark messages as read
    socket.on('message:markRead', async (data) => {
      try {
        const { messageId, conversationId } = data;
        const userId = socket.user.id;
        
        // Update message in database
        const { data: updatedMessage, error } = await supabase
          .from('messages')
          .update({
            is_read: true,
            updated_at: new Date()
          })
          .eq('id', messageId)
          .eq('receiver_id', userId) // Safety check to ensure user can only mark messages sent to them
          .select()
          .single();
          
        if (error) {
          console.error('Error marking message as read:', error);
          socket.emit('error', {
            source: 'message:markRead',
            message: 'Failed to mark message as read'
          });
          return;
        }
        
        // Emit read receipt to sender
        const senderSocketId = connectedUsers.get(updatedMessage.sender_id);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message:read', {
            messageId,
            conversationId,
            readAt: updatedMessage.updated_at,
            readBy: userId
          });
        }
        
        // Confirm to the reader
        socket.emit('message:readConfirmed', {
          messageId,
          conversationId,
          readAt: updatedMessage.updated_at
        });
          
      } catch (error) {
        console.error('Error in message:markRead:', error);
        socket.emit('error', {
          source: 'message:markRead',
          message: 'Server error processing read receipt'
        });
      }
    });

    // Mark all messages in a conversation as read
    socket.on('message:markAllRead', async (data) => {
      try {
        const { conversationId } = data;
        const userId = socket.user.id;
        
        // Find the other user ID from the conversation
        let otherUserId;
        if (conversationId.startsWith('conv_')) {
          // If using conversation IDs in format conv_user1_user2
          const userIds = conversationId.substring(5).split('_');
          otherUserId = userIds[0] === userId ? userIds[1] : userIds[0];
        } else {
          otherUserId = conversationId; // Direct using user ID
        }
        
        // Update all unread messages in database
        const { data: updatedMessages, error } = await supabase
          .from('messages')
          .update({
            is_read: true,
            updated_at: new Date()
          })
          .eq('receiver_id', userId)
          .eq('sender_id', otherUserId)
          .eq('is_read', false)
          .select('id');
          
        if (error) {
          console.error('Error marking all messages as read:', error);
          socket.emit('error', {
            source: 'message:markAllRead',
            message: 'Failed to mark messages as read'
          });
          return;
        }
        
        const messageIds = updatedMessages.map(msg => msg.id);
        
        // Emit read receipt to sender
        const senderSocketId = connectedUsers.get(otherUserId);
        if (senderSocketId && messageIds.length > 0) {
          io.to(senderSocketId).emit('message:allRead', {
            messageIds,
            conversationId,
            readAt: new Date().toISOString(),
            readBy: userId
          });
        }
        
        // Confirm to the reader
        socket.emit('message:allReadConfirmed', {
          count: messageIds.length,
          conversationId,
          readAt: new Date().toISOString()
        });
          
      } catch (error) {
        console.error('Error in message:markAllRead:', error);
        socket.emit('error', {
          source: 'message:markAllRead',
          message: 'Server error processing read receipts'
        });
      }
    });

    // Edit a message
    socket.on('message:edit', async (data) => {
      try {
        const { messageId, content } = data;
        const userId = socket.user.id;
        
        // First, fetch the message to verify ownership
        const { data: message, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', messageId)
          .single();
          
        if (fetchError || !message) {
          console.error('Error fetching message:', fetchError);
          socket.emit('error', {
            source: 'message:edit',
            message: 'Message not found'
          });
          return;
        }
        
        // Verify the user is the sender
        if (message.sender_id !== userId) {
          socket.emit('error', {
            source: 'message:edit',
            message: 'You can only edit your own messages'
          });
          return;
        }
        
        // Check if message is too old to edit (optional - for example, 24 hours)
        const messageTime = new Date(message.created_at).getTime();
        const currentTime = new Date().getTime();
        const timeLimit = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        if (currentTime - messageTime > timeLimit) {
          socket.emit('error', {
            source: 'message:edit',
            message: 'Message is too old to edit'
          });
          return;
        }
        
        // Update the message
        const { data: updatedMessage, error: updateError } = await supabase
          .from('messages')
          .update({
            content: content,
            updated_at: new Date(),
            is_edited: true
          })
          .eq('id', messageId)
          .select()
          .single();
          
        if (updateError) {
          console.error('Error updating message:', updateError);
          socket.emit('error', {
            source: 'message:edit',
            message: 'Failed to update message'
          });
          return;
        }
        
        // Notify receiver about edit
        const receiverSocketId = connectedUsers.get(message.receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:edited', {
            messageId,
            conversationId: message.receiver_id,
            content: updatedMessage.content,
            updatedAt: updatedMessage.updated_at
          });
        }
        
        // Confirm to sender
        socket.emit('message:editConfirmed', {
          messageId,
          conversationId: message.receiver_id,
          content: updatedMessage.content,
          updatedAt: updatedMessage.updated_at
        });
          
      } catch (error) {
        console.error('Error in message:edit:', error);
        socket.emit('error', {
          source: 'message:edit',
          message: 'Server error processing message edit'
        });
      }
    });

    // Delete a message
    socket.on('message:delete', async (data) => {
      try {
        const { messageId, forEveryone = false } = data;
        const userId = socket.user.id;
        
        // First, fetch the message to verify ownership
        const { data: message, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', messageId)
          .single();
          
        if (fetchError || !message) {
          console.error('Error fetching message:', fetchError);
          socket.emit('error', {
            source: 'message:delete',
            message: 'Message not found'
          });
          return;
        }
        
        // Verify the user is either the sender (can delete for everyone) or receiver (can delete for self)
        if (message.sender_id !== userId && message.receiver_id !== userId) {
          socket.emit('error', {
            source: 'message:delete',
            message: 'You do not have permission to delete this message'
          });
          return;
        }
        
        // Handle delete for everyone (sender only) or delete for self
        if (forEveryone && message.sender_id === userId) {
          // Completely delete the message
          const { error: deleteError } = await supabase
            .from('messages')
            .delete()
            .eq('id', messageId);
            
          if (deleteError) {
            console.error('Error deleting message:', deleteError);
            socket.emit('error', {
              source: 'message:delete',
              message: 'Failed to delete message'
            });
            return;
          }
          
          // Notify receiver about deletion
          const receiverSocketId = connectedUsers.get(message.receiver_id);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message:deleted', {
              messageId,
              conversationId: message.receiver_id, // Using receiver ID as conversation ID
              deletedBy: userId,
              deletedForEveryone: true
            });
          }
          
          // Confirm to sender
          socket.emit('message:deleteConfirmed', {
            messageId,
            conversationId: message.receiver_id,
            deletedForEveryone: true
          });
          
        } else {
          // For "delete for self" - keep message but mark as deleted for this user
          // This requires an additional column in your messages table
          
          // Example implementation (you may need to modify based on your schema)
          const updateField = message.sender_id === userId 
            ? { deleted_by_sender: true }
            : { deleted_by_receiver: true };
            
          const { error: updateError } = await supabase
            .from('messages')
            .update(updateField)
            .eq('id', messageId);
            
          if (updateError) {
            console.error('Error updating message delete status:', updateError);
            socket.emit('error', {
              source: 'message:delete',
              message: 'Failed to delete message'
            });
            return;
          }
          
          // Confirm to user
          socket.emit('message:deleteConfirmed', {
            messageId,
            conversationId: message.sender_id === userId ? message.receiver_id : message.sender_id,
            deletedForEveryone: false
          });
        }
          
      } catch (error) {
        console.error('Error in message:delete:', error);
        socket.emit('error', {
          source: 'message:delete',
          message: 'Server error processing message deletion'
        });
      }
    });

    // Add a reaction to a message
    socket.on('message:react', async (data) => {
      try {
        const { messageId, reaction } = data;
        const userId = socket.user.id;
        
        // First, fetch the message
        const { data: message, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', messageId)
          .single();
          
        if (fetchError || !message) {
          console.error('Error fetching message:', fetchError);
          socket.emit('error', {
            source: 'message:react',
            message: 'Message not found'
          });
          return;
        }
        
        // Verify user is part of the conversation
        if (message.sender_id !== userId && message.receiver_id !== userId) {
          socket.emit('error', {
            source: 'message:react',
            message: 'You cannot react to this message'
          });
          return;
        }
        
        // Check if message_reactions table exists, if not create it
        // This assumes you'll add a message_reactions table to your database
        
        // Remove any existing reaction from this user
        await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', userId);
          
        // Add the new reaction (if not null/empty)
        let reactionData = null;
        
        if (reaction) {
          const { data: newReaction, error: insertError } = await supabase
            .from('message_reactions')
            .insert({
              message_id: messageId,
              user_id: userId,
              reaction: reaction,
              created_at: new Date()
            })
            .select()
            .single();
            
          if (insertError) {
            console.error('Error adding reaction:', insertError);
            socket.emit('error', {
              source: 'message:react',
              message: 'Failed to add reaction'
            });
            return;
          }
          
          reactionData = newReaction;
        }
        
        // Get all reactions for this message
        const { data: allReactions, error: reactionsError } = await supabase
          .from('message_reactions')
          .select('*')
          .eq('message_id', messageId);
          
        if (reactionsError) {
          console.error('Error fetching reactions:', reactionsError);
        }
        
        // Format reactions summary
        const reactionsSummary = allReactions ? allReactions.reduce((acc, curr) => {
          if (!acc[curr.reaction]) acc[curr.reaction] = [];
          acc[curr.reaction].push(curr.user_id);
          return acc;
        }, {}) : {};
        
        // Determine other party in the conversation
        const otherUserId = message.sender_id === userId ? message.receiver_id : message.sender_id;
        
        // Notify other user about reaction
        const otherUserSocketId = connectedUsers.get(otherUserId);
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('message:reacted', {
            messageId,
            userId,
            reaction,
            conversationId: otherUserId === message.receiver_id ? userId : otherUserId,
            reactionsSummary
          });
        }
        
        // Confirm to user who reacted
        socket.emit('message:reactConfirmed', {
          messageId,
          reaction,
          conversationId: otherUserId,
          reactionsSummary
        });
          
      } catch (error) {
        console.error('Error in message:react:', error);
        socket.emit('error', {
          source: 'message:react',
          message: 'Server error processing reaction'
        });
      }
    });

    // Send a reply to a specific message
    socket.on('message:reply', async (data) => {
      try {
        const { receiverId, content, replyToMessageId, mediaUrl } = data;
        const senderId = socket.user.id;
        
        // Validate required fields
        if (!receiverId || !content || !replyToMessageId) {
          socket.emit('error', {
            source: 'message:reply',
            message: 'Receiver ID, content, and replyToMessageId are required'
          });
          return;
        }
        
        // Fetch the original message being replied to
        const { data: originalMessage, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', replyToMessageId)
          .single();
          
        if (fetchError) {
          console.error('Error fetching original message:', fetchError);
          socket.emit('error', {
            source: 'message:reply',
            message: 'Original message not found'
          });
          return;
        }
        
        // Create message with reply metadata
        const { data: message, error } = await supabase
          .from('messages')
          .insert({
            sender_id: senderId,
            receiver_id: receiverId,
            content,
            media_url: mediaUrl || null,
            is_read: false,
            created_at: new Date(),
            updated_at: new Date(),
            reply_to_message_id: replyToMessageId,
            reply_to_content: originalMessage.content.substring(0, 100) // Store preview of original
          })
          .select()
          .single();
        
        if (error) {
          console.error('Error creating reply message:', error);
          socket.emit('error', {
            source: 'message:reply',
            message: 'Failed to send reply'
          });
          return;
        }
        
        // Add sender info to the message object
        message.sender = {
          id: socket.user.id,
          firstName: socket.user.first_name,
          lastName: socket.user.last_name,
          username: socket.user.username,
          profilePictureUrl: socket.user.profile_picture_url
        };
        
        // Add reply info
        message.replyTo = {
          messageId: originalMessage.id,
          content: originalMessage.content,
          senderId: originalMessage.sender_id
        };
        
        // Emit to sender
        socket.emit('message:sent', message);
        
        // Emit to receiver if online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:received', message);
        }
          
      } catch (error) {
        console.error('Error in message:reply:', error);
        socket.emit('error', {
          source: 'message:reply',
          message: 'Server error sending reply'
        });
      }
    });

    // Enhanced Match Chat Features

    // Edit a match chat message
    socket.on('match:editMessage', (data) => {
      try {
        const { matchId, messageId, content } = data;
        const userId = socket.user.id;
        
        // Emit edited message to the match room
        socket.to(matchId).emit('match:messageEdited', {
          messageId,
          senderId: userId,
          senderName: socket.user.username || 'User',
          content,
          editedAt: new Date().toISOString()
        });
        
        // Confirm to sender
        socket.emit('match:messageEditConfirmed', {
          messageId,
          matchId,
          content,
          editedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error editing match message:', error);
        socket.emit('error', {
          source: 'match:editMessage',
          message: 'Failed to edit message'
        });
      }
    });

    // Delete a match chat message
    socket.on('match:deleteMessage', (data) => {
      try {
        const { matchId, messageId } = data;
        const userId = socket.user.id;
        
        // Emit deletion to the match room
        socket.to(matchId).emit('match:messageDeleted', {
          messageId,
          deletedBy: userId,
          deletedAt: new Date().toISOString()
        });
        
        // Confirm to sender
        socket.emit('match:messageDeleteConfirmed', {
          messageId,
          matchId,
          deletedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error deleting match message:', error);
        socket.emit('error', {
          source: 'match:deleteMessage',
          message: 'Failed to delete message'
        });
      }
    });

    // React to a match chat message
    socket.on('match:reactToMessage', (data) => {
      try {
        const { matchId, messageId, reaction } = data;
        const userId = socket.user.id;
        
        // Emit reaction to the match room
        socket.to(matchId).emit('match:messageReaction', {
          messageId,
          userId,
          reaction,
          timestamp: new Date().toISOString()
        });
        
        // Confirm to sender
        socket.emit('match:reactionConfirmed', {
          messageId,
          matchId,
          reaction,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error processing match message reaction:', error);
        socket.emit('error', {
          source: 'match:reactToMessage',
          message: 'Failed to process reaction'
        });
      }
    });

    // Reply to a match chat message
    socket.on('match:replyToMessage', (data) => {
      try {
        const { matchId, replyToMessageId, replyToContent, message } = data;
        const userId = socket.user.id;
        
        // Generate a unique ID for this message
        const messageId = uuidv4();
        
        // Emit the reply to the match room
        socket.to(matchId).emit('match:message', {
          messageId,
          senderId: userId,
          senderName: socket.user.username || 'User',
          message,
          timestamp: new Date().toISOString(),
          replyTo: {
            messageId: replyToMessageId,
            content: replyToContent
          }
        });
        
        // Send confirmation to sender
        socket.emit('match:messageSent', {
          messageId,
          matchId,
          message,
          timestamp: new Date().toISOString(),
          replyTo: {
            messageId: replyToMessageId,
            content: replyToContent
          }
        });
      } catch (error) {
        console.error('Error sending match reply:', error);
        socket.emit('error', {
          source: 'match:replyToMessage',
          message: 'Failed to send reply'
        });
      }
    });

    // Enhanced typing indicators
    socket.on('typing:start', (data) => {
      try {
        const { receiverId, matchId } = data;
        const userId = socket.user.id;
        
        // For private chat
        if (receiverId) {
          // Add to active conversations if not already added
          if (!socket.activeConversations) {
            socket.activeConversations = new Set();
          }
          socket.activeConversations.add(receiverId);
          
          // Ensure the user is actually in our connected users before attempting to emit
          const receiverSocketId = connectedUsers.get(receiverId);
          if (receiverSocketId) {
            const receiverSocket = io.sockets.sockets.get(receiverSocketId);
            if (receiverSocket) {
              // Add to receiver's active conversations as well
              if (!receiverSocket.activeConversations) {
                receiverSocket.activeConversations = new Set();
              }
              receiverSocket.activeConversations.add(userId);
              
              // Store last typing time to prevent flooding
              const now = Date.now();
              if (!socket.lastTypingEmit || now - socket.lastTypingEmit > 1000) {
            io.to(receiverSocketId).emit('typing:start', {
              userId,
                  username: socket.user.username,
              timestamp: new Date().toISOString()
            });
                socket.lastTypingEmit = now;
              }
              
              // Set a timeout to automatically send typing:stop if not refreshed
              if (socket.typingTimeout) {
                clearTimeout(socket.typingTimeout);
              }
              
              socket.typingTimeout = setTimeout(() => {
                // Auto-stop typing after 5 seconds of no typing activity
                io.to(receiverSocketId).emit('typing:stop', {
                  userId,
                  timestamp: new Date().toISOString()
                });
                socket.isTyping = false;
              }, 5000);
              
              socket.isTyping = true;
            } else {
              // Socket ID exists but socket is invalid, clean up
              connectedUsers.delete(receiverId);
            }
          }
        }
        
        // For match chat
        if (matchId) {
          // Store last typing time to prevent flooding
          const now = Date.now();
          if (!socket.lastMatchTypingEmit || now - socket.lastMatchTypingEmit > 1000) {
          socket.to(matchId).emit('match:typing', {
            userId,
            username: socket.user.username,
            isTyping: true,
            timestamp: new Date().toISOString()
          });
            socket.lastMatchTypingEmit = now;
          }
          
          // Set a timeout to automatically send typing:stop if not refreshed
          if (socket.matchTypingTimeout) {
            clearTimeout(socket.matchTypingTimeout);
          }
          
          socket.matchTypingTimeout = setTimeout(() => {
            // Auto-stop typing after 5 seconds of inactivity
            socket.to(matchId).emit('match:typing', {
              userId,
              username: socket.user.username,
              isTyping: false,
              timestamp: new Date().toISOString()
            });
          }, 5000);
        }
      } catch (error) {
        console.error('Error in typing indicator:', error);
      }
    });

    socket.on('typing:stop', (data) => {
      try {
        const { receiverId, matchId } = data;
        const userId = socket.user.id;
        
        // Clear any typing timeouts
        if (socket.typingTimeout) {
          clearTimeout(socket.typingTimeout);
        }
        
        // For private chat
        if (receiverId) {
          const receiverSocketId = connectedUsers.get(receiverId);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('typing:stop', {
              userId,
              timestamp: new Date().toISOString()
            });
          }
          socket.isTyping = false;
        }
        
        // For match chat
        if (matchId) {
          if (socket.matchTypingTimeout) {
            clearTimeout(socket.matchTypingTimeout);
          }
          
          socket.to(matchId).emit('match:typing', {
            userId,
            username: socket.user.username,
            isTyping: false,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('Error in typing indicator:', error);
      }
    });
    
    // Handle typing indicators
    socket.on('typing:start', (data) => {
      const { receiverId } = data;
      const receiverSocketId = connectedUsers.get(receiverId);
      
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:start', {
          userId: socket.user.id
        });
      }
    });
    
    socket.on('typing:stop', (data) => {
      const { receiverId } = data;
      const receiverSocketId = connectedUsers.get(receiverId);
      
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing:stop', {
          userId: socket.user.id
        });
      }
    });
    
    // Handle read receipts
    socket.on('message:read', async (data) => {
      try {
        const { messageId } = data;
        
        // Update message as read in database
        const { data: message, error } = await supabase
          .from('messages')
          .update({
            is_read: true,
            updated_at: new Date()
          })
          .eq('id', messageId)
          .eq('receiver_id', socket.user.id)
          .select()
          .single();
        
        if (error) {
          console.error('Error marking message as read:', error);
          return;
        }
        
        // Emit read receipt to sender if online
        const senderSocketId = connectedUsers.get(message.sender_id);
        if (senderSocketId) {
          io.to(senderSocketId).emit('message:read', {
            messageId,
            readAt: message.updated_at
          });
        }
      } catch (error) {
        console.error('Message read error:', error);
      }
    });
    
    // Handle matchmaking events
    socket.on('match:find', async (criteria = {}) => {
      try {
        // Clear any existing matchmaking timeouts for this user
        const userId = socket.user.id;
        clearMatchmakingTimeouts(userId);
        
        console.log(`Finding match for user: ${userId}`);
        console.log('Match criteria:', JSON.stringify(criteria));
        
        // Extract preference from incoming criteria if available
        const clientPreference = criteria.preferences?.chatType;
        
        // Handle preference mapping from client format to server format
        if (clientPreference) {
          // Update socket user preference with client preference (properly capitalized)
          if (clientPreference.toLowerCase() === 'friendship') {
            socket.user.preference = 'Friendship';
          } else if (clientPreference.toLowerCase() === 'dating') {
            socket.user.preference = 'Dating';
          }
          console.log(`Updated user preference from client request: ${socket.user.preference}`);
        }
        
        console.log(`User interests: ${JSON.stringify(socket.user.interests)}`);
        console.log(`User preference: ${socket.user.preference}`);
        
        // Validate that user has interests
        if (!socket.user.interests || socket.user.interests.length === 0) {
          console.log(`User ${userId} has no interests. Aborting match.`);
          socket.emit('error', { 
            source: 'matchmaking',
            message: 'You need to add interests to your profile before matchmaking' 
          });
          return;
        }
        
        // Validate that user has a preference set
        if (!socket.user.preference) {
          console.log(`User ${userId} has no preference set. Aborting match.`);
          socket.emit('error', { 
            source: 'matchmaking',
            message: 'You need to set your preference (Dating or Friendship) before matchmaking' 
          });
          return;
        }
        
        // Verify socket is connected
        const socketId = connectedUsers.get(userId);
        if (!socketId || socketId !== socket.id) {
          console.log(`User ${userId} has inconsistent socket information. Updating socket ID.`);
          connectedUsers.set(userId, socket.id);
        }
        
        // Add user to matchmaking pool with updated preference
        matchmakingPool.set(userId, {
          userId,
          socketId: socket.id,
          user: socket.user,
          criteria,
          interests: socket.user.interests,
          joinedAt: new Date(),
          isBeingProcessed: false
        });
        
        console.log(`Added user ${userId} to matchmaking pool. Pool size: ${matchmakingPool.size}`);
        socket.emit('match:waiting', { 
          message: `Searching for a ${socket.user.preference} match with similar interests...` 
        });
        
        // Find a match for this user
        findMatchForUser(socket);
      } catch (error) {
        console.error('Error finding match:', error);
        socket.emit('error', {
          source: 'matchmaking',
          message: 'Error finding a match, please try again'
        });
      }
    });
    
    // Add handler for 'findRandomMatch' event (frontend naming convention)
    socket.on('findRandomMatch', async (criteria = {}) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} is looking for a random match with criteria:`, criteria);
        
        // Extract preference from incoming criteria if available
        const clientPreference = criteria.preferences?.chatType;
        
        // Handle preference mapping from client format to server format
        if (clientPreference) {
          // Update socket user preference with client preference (properly capitalized)
          if (clientPreference.toLowerCase() === 'friendship') {
            socket.user.preference = 'Friendship';
          } else if (clientPreference.toLowerCase() === 'dating') {
            socket.user.preference = 'Dating';
          }
          console.log(`Updated user preference from client request: ${socket.user.preference}`);
        }
        
        console.log(`User preference: ${socket.user.preference}`);
        
        // Clear any existing matchmaking timeouts for this user
        clearMatchmakingTimeouts(userId);
        
        // Validate that user has defined interests
        if (!socket.user.interests || !Array.isArray(socket.user.interests) || socket.user.interests.length === 0) {
          socket.emit('error', {
            source: 'findRandomMatch',
            message: 'You must have at least one interest defined in your profile'
          });
          return;
        }
        
        // Validate that user has a preference set
        if (!socket.user.preference) {
          console.log(`User ${userId} has no preference set. Aborting match.`);
          socket.emit('error', { 
            source: 'findRandomMatch',
            message: 'You need to set your preference (Dating or Friendship) before matchmaking' 
          });
          return;
        }
        
        // Verify socket is connected
        const socketId = connectedUsers.get(userId);
        if (!socketId || socketId !== socket.id) {
          console.log(`User ${userId} has inconsistent socket information. Updating socket ID.`);
          connectedUsers.set(userId, socket.id);
        }
        
        // Add user to matchmaking pool with updated preference
        matchmakingPool.set(userId, {
          userId,
          socketId: socket.id,
          user: socket.user,
          criteria,
          interests: socket.user.interests,
          joinedAt: new Date(),
          isBeingProcessed: false
        });
        
        console.log(`Added user ${userId} to matchmaking pool. Pool size: ${matchmakingPool.size}`);
        socket.emit('match:waiting', {
          message: `Looking for users with similar interests who also want ${socket.user.preference}...`
        });
        
        // Find a match for this user
        findMatchForUser(socket);
      } catch (error) {
        console.error('Error finding random match:', error);
        socket.emit('error', {
          source: 'findRandomMatch',
          message: 'Error finding a match'
        });
      }
    });
    
    // Handle cancel matchmaking request
    socket.on('cancelRandomMatch', () => {
      const userId = socket.user.id;
      console.log(`User ${userId} cancelled matchmaking`);
      
      // Remove from matchmaking pool
      matchmakingPool.delete(userId);
      
      // Clear any timeouts
      clearMatchmakingTimeouts(userId);
      
      socket.emit('match:cancelled', {
        message: 'Matchmaking cancelled'
      });
    });
    
    // Handle client disconnection
    socket.on('disconnect', async (reason) => {
      try {
        info(`User disconnected: ${socket.user.id} (${socket.user.username}), reason: ${reason}`);
        
        // Only update status after a grace period to allow for short reconnects
        const disconnectTimeout = setTimeout(async () => {
          // Check if user is still connected via a different socket
          const isUserStillConnected = Array.from(io.sockets.sockets.values()).some(
            s => s.user && s.user.id === socket.user.id && s.id !== socket.id
          );
          
          if (!isUserStillConnected) {
            // Update user's online status in database
            await updateUserOnlineStatus(socket.user.id, false);
            
            // Notify other users of offline status
            io.emit('user:status', {
              userId: socket.user.id,
              online: false,
              lastSeen: new Date().toISOString()
            });
            
            // Log status change for monitoring
            info(`User ${socket.user.id} (${socket.user.username}) marked as offline after disconnect`);
            
            // Remove from connected users map
            if (connectedUsers.get(socket.user.id) === socket.id) {
              connectedUsers.delete(socket.user.id);
            }
            
            // Clean up any active matches and conversations
            cleanupUserMatches(socket.user.id);
          } else {
            // User reconnected with a different socket
            info(`User ${socket.user.id} (${socket.user.username}) reconnected with a different socket, staying online`);
          }
        }, 5000); // Wait 5 seconds before marking as offline
        
        // Store disconnect timeout in a global map to allow cancellation on reconnect
        if (!global.disconnectTimeouts) {
          global.disconnectTimeouts = new Map();
        }
        global.disconnectTimeouts.set(socket.user.id, disconnectTimeout);
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    });

    // After the connection handler initialization, add these event handlers

    // Handle notification events
    socket.on('notification:read', async (data) => {
      try {
        const { notificationId } = data;
        const userId = socket.user.id;
        
        if (!notificationId) {
          socket.emit('error', {
            source: 'notification:read',
            message: 'Notification ID is required'
          });
          return;
        }
        
        const { markNotificationRead } = require('../services/notification/notificationService');
        const success = await markNotificationRead(notificationId, userId);
        
        if (!success) {
          socket.emit('error', {
            source: 'notification:read',
            message: 'Notification not found or could not be updated'
          });
          return;
        }
        
        socket.emit('notification:readConfirmed', {
          notificationId
        });
      } catch (err) {
        console.error('Error marking notification as read:', err);
        socket.emit('error', {
          source: 'notification:read',
          message: 'Server error while updating notification'
        });
      }
    });
    
    socket.on('notification:readAll', async () => {
      try {
        const userId = socket.user.id;
        
        const { error: updateError } = await supabase
          .from('notifications')
          .update({ 
            is_read: true,
            read_at: new Date()
          })
          .eq('user_id', userId)
          .eq('is_read', false);
        
        if (updateError) {
          console.error('Error marking all notifications as read:', updateError);
          socket.emit('error', {
            source: 'notification:readAll',
            message: 'Server error while updating notifications'
          });
          return;
        }
        
        socket.emit('notification:allRead', {
          success: true
        });
      } catch (err) {
        console.error('Error marking all notifications as read:', err);
        socket.emit('error', {
          source: 'notification:readAll',
          message: 'Server error while updating notifications'
            });
          }
        });
        
    socket.on('notification:getAll', async (data = {}) => {
      try {
        const userId = socket.user.id;
        const limit = parseInt(data.limit) || 20;
        const offset = parseInt(data.offset) || 0;
        const unreadOnly = data.unreadOnly === true;
        
        const { getUserNotifications } = require('../services/notification/notificationService');
        const notifications = await getUserNotifications(userId, {
          limit, 
          offset,
          unreadOnly
        });
        
        socket.emit('notification:list', {
          notifications,
          pagination: {
            limit,
            offset,
            hasMore: notifications.length === limit
          }
        });
      } catch (err) {
        console.error('Error fetching notifications:', err);
        socket.emit('error', {
          source: 'notification:getAll',
          message: 'Server error while fetching notifications'
        });
      }
    });
    
    socket.on('notification:getCount', async () => {
      try {
        const userId = socket.user.id;
        
        const { count, error: countError } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false);
        
        if (countError) {
          console.error('Error counting unread notifications:', countError);
        socket.emit('error', {
            source: 'notification:getCount',
            message: 'Server error while counting notifications'
          });
          return;
        }
        
        socket.emit('notification:count', { count });
      } catch (err) {
        console.error('Error counting notifications:', err);
        socket.emit('error', {
          source: 'notification:getCount',
          message: 'Server error while counting notifications'
        });
      }
    });

    // Add this to the socket.on connection handler section

    // Provide achievement data
    socket.on('achievement:get', async () => {
      try {
        const userId = socket.user.id;
        const { getUserAchievements, getUserPoints } = require('../services/achievement/achievementService');
        
        const achievements = await getUserAchievements(userId);
        const points = await getUserPoints(userId);
        
        socket.emit('achievement:data', {
          achievements,
          points
        });
      } catch (err) {
        console.error('Error fetching achievements:', err);
          socket.emit('error', {
          source: 'achievement:get',
          message: 'Error fetching achievement data'
        });
      }
    });
    
    // Get user's active streaks
    socket.on('streak:getAll', async () => {
      try {
      const userId = socket.user.id;
        const { getUserActiveStreaks } = require('../services/achievement/streakService');
        
        const streaks = await getUserActiveStreaks(userId);
        
        socket.emit('streak:data', {
          streaks
        });
      } catch (err) {
        console.error('Error fetching streaks:', err);
          socket.emit('error', {
          source: 'streak:getAll',
          message: 'Error fetching streak data'
        });
      }
    });

    // In the connection handler, after all existing socket event handlers, add these new AI-powered event handlers

    // Add these AI feature handlers at the end of the connection handler
    
    // AI message suggestions handler
    socket.on('ai:messageSuggestions', async ({ conversationId }, callback) => {
      try {
        info('Generating AI message suggestions', { userId: socket.user.id, conversationId });
        
        if (!conversationId) {
          return callback({
            success: false,
            error: { message: 'Conversation ID is required' }
          });
        }
        
        const suggestions = await generateMessageSuggestions(conversationId);
        
        callback({
          success: true,
          suggestions
        });
      } catch (error) {
        console.error('Error generating message suggestions', { error, userId: socket.user.id, conversationId });
        callback({
          success: false,
          error: { message: 'Failed to generate message suggestions' }
        });
      }
    });
    
    // AI feature: Generate profile bio
    socket.on('ai:generateBio', async (data, callback) => {
      try {
        info('Generating AI profile bio', { userId: socket.user.id });
        
        const bio = await generateProfileBio(socket.user.id);
        
        callback({
          success: true,
          bio
        });
      } catch (err) {
        console.error('Error generating profile bio', { error: err, userId: socket.user.id });
        callback({
          success: false,
          error: { message: 'Failed to generate profile bio' }
        });
      }
    });
    
    // AI feature: Generate icebreakers
    socket.on('ai:generateIcebreakers', async ({ matchId }, callback) => {
      try {
        info('Generating AI icebreakers', { userId: socket.user.id, matchId });
        
        if (!matchId) {
          return callback({
            success: false,
            error: { message: 'Match ID is required' }
          });
        }
        
        const icebreakers = await generateIcebreakers(matchId);
        
        callback({
          success: true,
          icebreakers
        });
      } catch (err) {
        console.error('Error generating icebreakers', { error: err, userId: socket.user.id, matchId });
        callback({
          success: false,
          error: { message: 'Failed to generate icebreakers' }
        });
      }
    });
    
    // AI feature: Detect conversation mood
    socket.on('ai:detectMood', async ({ conversationId }, callback) => {
      try {
        info('Detecting conversation mood', { userId: socket.user.id, conversationId });
        
        if (!conversationId) {
          return callback({
            success: false,
            error: { message: 'Conversation ID is required' }
          });
        }
        
        const { mood, confidence } = await detectConversationMood(conversationId);
        
        callback({
          success: true,
          mood,
          confidence
        });
      } catch (err) {
        console.error('Error detecting conversation mood', { error: err, userId: socket.user.id, conversationId });
        callback({
          success: false,
          error: { message: 'Failed to detect conversation mood' }
        });
      }
    });
    
    // Inside initializeSocket function, add these socket handlers
    // Note: These will be added to the existing socket handlers

    // Handle matchmaking join request - allows users to explicitly join matchmaking
    socket.on('matchmaking:join', (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { source: 'matchmaking', message: 'Not authenticated' });
          return;
        }
        
        const userId = socket.user.id;
        const userPreference = data?.preference || socket.user.preference || 'Friendship';
        const userInterests = socket.user.interests || [];
        
        // Validate that user has interests
        if (!userInterests || userInterests.length === 0) {
          socket.emit('error', {
            source: 'matchmaking', 
            message: 'You need to add interests to your profile before matchmaking' 
          });
          return;
        }
        
        // Validate that user has a preference set
        if (!userPreference) {
          socket.emit('error', { 
            source: 'matchmaking', 
            message: 'You need to set your preference (Dating or Friendship) before matchmaking' 
          });
          return;
        }
        
        // Add user to matchmaking pool
              matchmakingPool.set(userId, {
                userId,
                socketId: socket.id,
                user: socket.user,
          interests: userInterests,
          joinedAt: new Date(),
          isBeingProcessed: false
        });
        
        info(`User ${userId} joined matchmaking with preference: ${userPreference}`);
        
        // Confirm to user
        socket.emit('matchmaking:status', { 
          status: 'joined', 
          message: 'You have joined matchmaking. Searching for a match...', 
          poolSize: matchmakingPool.size 
        });
        
        // Set a timeout to find match soon
        setTimeout(() => {
          if (connectedUsers.has(userId) && matchmakingPool.has(userId)) {
            findMatchForUser(socket, false); // Try to find a human match first
          }
        }, 2000);
      } catch (err) {
        error(`Error in matchmaking:join handler: ${err.message}`);
        socket.emit('error', {
          source: 'matchmaking', 
          message: 'Server error joining matchmaking' 
        });
      }
    });
    
    // Handle matchmaking leave request
    socket.on('matchmaking:leave', () => {
      try {
        if (!socket.user) {
          return;
        }
        
      const userId = socket.user.id;
      
      // Remove user from matchmaking pool
        if (matchmakingPool.has(userId)) {
      matchmakingPool.delete(userId);
          info(`User ${userId} left matchmaking`);
      
          // Clear any timeouts
      clearMatchmakingTimeouts(userId);
      
          // Confirm to user
          socket.emit('matchmaking:status', { 
            status: 'left', 
            message: 'You have left matchmaking', 
            poolSize: matchmakingPool.size 
          });
        }
      } catch (err) {
        error(`Error in matchmaking:leave handler: ${err.message}`);
      }
    });
    
    // Handle matchmaking status check
    socket.on('matchmaking:status', () => {
      try {
        if (!socket.user) {
          socket.emit('error', { source: 'matchmaking', message: 'Not authenticated' });
          return;
        }
        
        const userId = socket.user.id;
        const status = matchmakingPool.has(userId) ? 'joined' : 'not_joined';
        const message = matchmakingPool.has(userId) 
          ? 'You are currently in matchmaking' 
          : 'You are not currently in matchmaking';
        
        socket.emit('matchmaking:status', { 
          status, 
          message, 
          poolSize: matchmakingPool.size 
        });
      } catch (err) {
        error(`Error in matchmaking:status handler: ${err.message}`);
      }
    });
    
    // Handle explicit match request - allows users to request a match directly
    socket.on('find:match', (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { source: 'matchmaking', message: 'Not authenticated' });
          return;
        }
        
        const userId = socket.user.id;
        const forceBotMatch = data?.forceBotMatch === true;
        
        // Check if user is already in matchmaking
        if (!matchmakingPool.has(userId)) {
          // Add user to matchmaking pool
          matchmakingPool.set(userId, {
            userId,
            socketId: socket.id,
            user: socket.user,
            interests: socket.user.interests || [],
            joinedAt: new Date(),
            isBeingProcessed: false
          });
          
          info(`User ${userId} joined matchmaking via find:match`);
        }
        
        // Let user know we're searching
        socket.emit('matchmaking:status', { 
          status: 'searching', 
          message: 'Searching for a match...', 
          poolSize: matchmakingPool.size 
        });
        
        // Find a match immediately
        findMatchForUser(socket, forceBotMatch);
      } catch (err) {
        error(`Error in find:match handler: ${err.message}`);
        socket.emit('error', {
          source: 'matchmaking', 
          message: 'Server error finding a match' 
        });
      }
    });
    
    // Handle bot message
    socket.on('match:messageBot', (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { source: 'chat', message: 'Not authenticated' });
          return;
        }
        
        const { matchId, message } = data;
        
        if (!matchId || !message) {
          socket.emit('error', { source: 'chat', message: 'Invalid message data' });
          return;
        }
        
        // Check if this is a bot match
        if (!botMatches.has(matchId)) {
          socket.emit('error', { source: 'chat', message: 'This is not a bot match' });
          return;
        }
        
        // Get bot match data
        const botMatch = botMatches.get(matchId);
        
        // Verify this user is part of this match
        if (botMatch.userId !== socket.user.id) {
          socket.emit('error', { source: 'chat', message: 'You are not part of this match' });
          return;
        }
        
        // Handle bot response
        handleBotResponse(matchId, message, socket);
        
        // Send immediate ack to user
        socket.emit('match:messageAck', { matchId, status: 'delivered' });
      } catch (err) {
        error(`Error in match:messageBot handler: ${err.message}`);
        socket.emit('error', {
          source: 'chat', 
          message: 'Server error sending message to bot' 
        });
      }
    });
    
    // Handle chat opened event - sends a bot message when user opens a chat
    socket.on('chat:open', (data) => {
      try {
        if (!socket.user) {
          socket.emit('error', { source: 'chat', message: 'Not authenticated' });
          return;
        }
        
        const { matchId } = data;
        
        if (!matchId) {
          socket.emit('error', { source: 'chat', message: 'Match ID is required' });
          return;
        }
        
        // Check if this is a bot match
        if (!botMatches.has(matchId)) {
          // Not a bot match, just join the room silently
          if (!socket.rooms.has(matchId)) {
            socket.join(matchId);
            info(`User ${socket.user.id} joined match room ${matchId} via chat:open`);
          }
          return;
        }
        
        // Get bot match data
        const botMatch = botMatches.get(matchId);
        
        // Verify this user is part of this match
        if (botMatch.userId !== socket.user.id) {
          // FIXED: Update the userId in botMatch to the current socket user's ID
          // This ensures the bot match has the correct userId for future responses
          botMatch.userId = socket.user.id;
          botMatches.set(matchId, botMatch);
          info(`Updated bot match ${matchId} with correct user ID ${socket.user.id}`);
        }
        
        // Join the match room if not already in it
        if (!socket.rooms.has(matchId)) {
          socket.join(matchId);
          info(`User ${socket.user.id} joined bot match room ${matchId} via chat:open`);
        }
        
        // Check if bot has sent any messages to this user
        if (botMatch.messages.length === 0) {
          // No messages yet, send an initial greeting after a slight delay
          setTimeout(() => {
            // Show bot typing
            socket.emit('match:typing', {
              matchId: matchId,
              senderId: botMatch.botProfile.id,
              typing: true
            });
            
            // Generate greeting after typing delay
            setTimeout(async () => {
              try {
                // Stop typing
                socket.emit('match:typing', {
                  matchId: matchId,
                  senderId: botMatch.botProfile.id,
                  typing: false
                });
                
                // Generate greeting messages based on preference
                const greetings = botMatch.preference === 'Dating' ? [
                  `Hi there! I'm ${botMatch.botProfile.firstName || botMatch.botProfile.first_name}. I noticed you opened our chat. How's your day going?`,
                  `Hey! I've been hoping to chat with you. What made you interested in my profile?`,
                  `Hello! Nice to connect with you. What are you looking for on this app?`
                ] : [
                  `Hi there! I'm ${botMatch.botProfile.firstName || botMatch.botProfile.first_name}. Thanks for starting a chat. What's been keeping you busy lately?`,
                  `Hey! Nice to meet you. I see we both like ${botMatch.botProfile.interests[0] || 'meeting new people'}. What other interests do you have?`,
                  `Hello! I'm always excited to make new friends. What do you enjoy doing in your free time?`
                ];
                
                const greeting = greetings[Math.floor(Math.random() * greetings.length)];
                const messageId = uuidv4();
                const timestamp = new Date().toISOString();
                
                // Create message object
                const messageObject = {
                  id: messageId,
                  matchId: matchId,
                  senderId: botMatch.botProfile.id,
                  senderName: `${botMatch.botProfile.firstName || botMatch.botProfile.first_name} ${botMatch.botProfile.lastName || botMatch.botProfile.last_name}`,
                  message: greeting,
                  timestamp,
                  isDelivered: true
                };
                
                // Store message in bot match history
                botMatch.messages.push({
                  senderId: botMatch.botProfile.id,
                  message: greeting,
                  timestamp,
                  id: messageId
                });
                
                // Send the greeting to the user
                socket.emit('match:message', messageObject);
                
                // Send delivery status
                socket.emit('match:messageDeliveryStatus', {
                  messageId: messageId,
                  matchId: matchId,
                  deliveryStatus: 'delivered',
                  deliveredAt: timestamp
                });
                
                // Try to store the message in database
                try {
                  const { storeBotMessage } = require('../services/ai/botProfileService');
                  storeBotMessage(botMatch.botProfile.id, socket.user.id, greeting)
                    .then(() => console.log(`Stored bot greeting on chat open for match ${matchId}`))
                    .catch(err => console.error(`Failed to store bot greeting: ${err.message}`));
                } catch (msgError) {
                  console.error(`Error storing bot greeting: ${msgError.message}`);
                }
              } catch (greetingError) {
                console.error(`Error generating bot greeting: ${greetingError.message}`);
              }
            }, 1000 + Math.random() * 1500); // 1-2.5 second typing delay
          }, 500 + Math.random() * 1000); // 0.5-1.5 second initial delay
        } else if (botMatch.messages.length > 0) {
          // Has previous messages, check if the last one was from the user and needs a response
          const lastMessage = botMatch.messages[botMatch.messages.length - 1];
          if (lastMessage && lastMessage.senderId === socket.user.id) {
            // Last message was from user, bot should respond
            console.log(`User opened chat with bot ${matchId} and has an unanswered message. Generating response...`);
            handleBotResponse(matchId, lastMessage.message, socket);
          }
        }
        
        // Mark bot's messages as read
        // Find messages from bot that need to be marked as read
        const botId = botMatch.botProfile.id;
        const unreadBotMessages = botMatch.messages.filter(msg => 
          msg.senderId === botId && (!msg.isRead || msg.isRead === false)
        );
        
        if (unreadBotMessages.length > 0) {
          // Mark messages as read in the bot match data
          botMatch.messages = botMatch.messages.map(msg => {
            if (msg.senderId === botId) {
              return { ...msg, isRead: true };
            }
            return msg;
          });
          
          // Update bot match in memory
          botMatches.set(matchId, botMatch);
          
          // Send read receipts to the client for all unread bot messages
          unreadBotMessages.forEach(msg => {
            if (msg.id) {
              socket.emit('match:messageRead', {
                messageId: msg.id,
                matchId: matchId,
                readAt: new Date().toISOString()
              });
            }
          });
        }
      } catch (err) {
        error(`Error in chat:open handler: ${err.message}`);
        socket.emit('error', {
          source: 'chat',
          message: 'Server error processing chat open event'
        });
      }
    });

    // Handle match acceptance
    socket.on('match:accept', async (data) => {
      try {
        const { matchId } = data;
        const userId = socket.user.id;
        
        // Get match data
        let otherUserId;
        let isBot = false;
        
        // Check if this is a bot match
        if (botMatches.has(matchId)) {
          const botMatch = botMatches.get(matchId);
          otherUserId = botMatch.botProfile.id;
          isBot = true;
          
          // Verify bot user exists in database before proceeding
          try {
            const { verifyAndRecoverBotUser } = require('../services/ai/botProfileService');
            await verifyAndRecoverBotUser(botMatch.botProfile);
            console.log(`Verified bot ${otherUserId} exists for match:accept`);
          } catch (botVerifyError) {
            console.error(`Error verifying bot user for match acceptance: ${botVerifyError.message}`);
            // We'll continue anyway - the verification tried its best to recover
          }
          
          // Bot automatically accepts, so just update user acceptance
          if (activeMatches.has(matchId)) {
            const matchData = activeMatches.get(matchId);
            matchData.acceptances[userId] = true;
            activeMatches.set(matchId, matchData);
          }
        } else if (activeMatches.has(matchId)) {
          // Regular match between users
          const matchData = activeMatches.get(matchId);
          otherUserId = matchData.users.find(id => id !== userId);
          
          // Update user acceptance
          matchData.acceptances[userId] = true;
          activeMatches.set(matchId, matchData);
        } else {
          socket.emit('error', {
            source: 'match:accept',
            message: 'Match not found'
          });
          return;
        }
        
        // Join match room if not already in it
        if (!socket.rooms.has(matchId)) {
          socket.join(matchId);
        }
        
        // Update match in database
        try {
          const { error: updateError } = await supabase
            .from('matches')
            .update({
              status: 'accepted',
              accepted_at: new Date(),
              updated_at: new Date()
            })
            .eq('id', matchId);
          
          if (updateError) {
            console.warn(`Non-critical error updating match in database: ${updateError.message}`);
            // Non-critical error, continue with the match
          }
        } catch (dbError) {
          console.error(`Error updating match in database: ${dbError.message}`);
          // Non-critical error, continue
        }
        
        // For bot matches, immediately have the bot send a welcome message
        if (isBot) {
          // Get the bot profile
          const botMatch = botMatches.get(matchId);
          
          // Send confirmation to user
          socket.emit('match:accepted', {
            matchId,
            userId: otherUserId,
            status: 'accepted'
          });
          
          // Have bot send welcome message after a delay
          setTimeout(() => {
            const botMessageId = uuidv4();
            const timestamp = new Date().toISOString();
            
            // Get greeting options based on preference
            const friendshipGreetings = [
              `Hi there! Nice to connect with you. I see we both like ${botMatch.botProfile.interests[0] || 'meeting new people'}. What do you enjoy most about it?`,
              `Hey! Thanks for accepting the match. I'm excited to chat with someone who shares my interests!`,
              `Hello! Glad we matched. I noticed we have some common interests. How's your day going so far?`
            ];
            
            const datingGreetings = [
              `Hi there! I'm glad we matched. I noticed we share some interests. What else do you enjoy?`,
              `Hello! Nice to connect with you. What attracted you to my profile?`,
              `Hey! Thanks for accepting the match. I'm looking forward to getting to know you better!`
            ];
            
            const greetings = botMatch.preference === 'Dating' ? datingGreetings : friendshipGreetings;
            const welcomeMessage = greetings[Math.floor(Math.random() * greetings.length)];
            
            // First show bot typing
            socket.emit('match:typing', {
              matchId: matchId,
              senderId: botMatch.botProfile.id,
              typing: true
            });
            
            // Send message after typing delay
            setTimeout(() => {
              // Stop typing
              socket.emit('match:typing', {
                matchId: matchId,
                senderId: botMatch.botProfile.id,
                typing: false
              });
              
              // Send welcome message
              setTimeout(() => {
                const messageObject = {
                  id: botMessageId,
                  matchId: matchId,
                  senderId: botMatch.botProfile.id,
                  senderName: `${botMatch.botProfile.firstName} ${botMatch.botProfile.lastName}`,
                  message: welcomeMessage,
                  timestamp,
                  isBot: true
                };
                
                socket.emit('match:message', messageObject);
                
                // Store message in database if needed
                try {
                  // Store bot message
                  const { storeBotMessage } = require('../services/ai/botProfileService');
                  storeBotMessage(botMatch.botProfile.id, userId, welcomeMessage)
                    .catch(msgError => console.error(`Error storing bot welcome message: ${msgError.message}`));
                } catch (msgError) {
                  console.error('Error storing bot welcome message:', msgError);
                }
                
                // Add to match history
                botMatch.messages.push({
                  senderId: botMatch.botProfile.id,
                  message: welcomeMessage,
                  timestamp
                });
              }, 300);
            }, 1500 + Math.random() * 1000);
          }, 1000);
        } else {
          // Regular match processing for real users
          // Notify other user
          const otherUserSocketId = connectedUsers.get(otherUserId);
          if (otherUserSocketId) {
            ioInstance.to(otherUserSocketId).emit('match:userAccepted', {
              matchId,
              userId
            });
          }
          
          // Send confirmation to user
          socket.emit('match:accepted', {
            matchId,
            userId: otherUserId,
            status: 'accepted'
          });
          
          // Check if both users have accepted
          if (activeMatches.has(matchId)) {
            const matchData = activeMatches.get(matchId);
            const bothAccepted = matchData.users.every(uid => matchData.acceptances[uid]);
            
            if (bothAccepted) {
              // Clear timeout
              const timeoutId = userTimeouts.get(userId);
              if (timeoutId) {
                clearTimeout(timeoutId);
                userTimeouts.delete(userId);
              }
              
              // Notify both users that match is confirmed
              matchData.users.forEach(uid => {
                const userSocketId = connectedUsers.get(uid);
                if (userSocketId) {
                  ioInstance.to(userSocketId).emit('match:confirmed', {
                    matchId,
                    users: matchData.users,
                    status: 'confirmed'
                  });
                }
              });
            }
          }
        }
      } catch (error) {
        console.error('Error accepting match:', error);
        socket.emit('error', {
          source: 'match:accept',
          message: 'Error accepting match'
        });
      }
    });
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
 * Find a match for a specific user
 * @param {object} socket - User's socket connection
 * @param {boolean} forceBotMatch - Whether to force a bot match if no user match is found
 */
const findMatchForUser = async (socket, forceBotMatch = false) => {
  try {
    const userId = socket.user.id;
    
    // If we're forcing a bot match or there are no suitable users, create a bot match
    if (forceBotMatch || matchmakingPool.size < 2) {
      console.log(`Creating bot match for user ${userId} ${forceBotMatch ? '(forced)' : '(no suitable users)'}`);
      
      try {
        // Create bot match for user
        const success = await createBotMatchForUser(socket);
        
        if (success) {
          // Bot match created successfully, remove user from matchmaking pool
          matchmakingPool.delete(userId);
          return;
        }
        
        // If bot match creation failed, notify user (only if forcing bot match)
        if (forceBotMatch) {
          socket.emit('match:notFound', {
            message: 'Sorry, no matches found. Please try again later.'
          });
          
          // Remove user from matchmaking pool
          matchmakingPool.delete(userId);
          return;
        }
        
        // If not forcing bot match, keep user in pool and wait for human match
        console.log(`Bot match creation failed, keeping user ${userId} in matchmaking pool`);
        // Reset processing flag
        if (matchmakingPool.has(userId)) {
          const userPoolData = matchmakingPool.get(userId);
          userPoolData.isBeingProcessed = false;
          matchmakingPool.set(userId, userPoolData);
        }
        return;
      } catch (botError) {
        console.error('Error creating bot match:', botError);
        
        // Notify user
        socket.emit('match:notFound', {
          message: 'Sorry, no matches found. Please try again later.'
        });
        
        // Remove user from matchmaking pool
        matchmakingPool.delete(userId);
        return;
      }
    }
    
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
        console.log(`Match user ${bestMatch.userId} no longer in pool, skipping match`);
        
        // Reset processing flag
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
        
        // Try again with a bot match if forced
        if (forceBotMatch) {
          createBotMatchForUser(socket);
        }
        
        return;
      }
      
      // Mark other user as being processed
      matchUser.isBeingProcessed = true;
      matchmakingPool.set(bestMatch.userId, matchUser);
      
      // Create match in database
      try {
        await createMatchInDatabase(matchId, userId, bestMatch.userId);
      } catch (dbError) {
        error(`Error creating match in database: ${dbError.message}`);
        
        // Reset processing flags
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
        
        matchUser.isBeingProcessed = false;
        matchmakingPool.set(bestMatch.userId, matchUser);
        
        // Try again with a bot match if forced
        if (forceBotMatch) {
          createBotMatchForUser(socket);
        }
        
        return;
      }
      
      // Get other user's socket
      const otherUserSocket = ioInstance.sockets.sockets.get(bestMatch.socketId);
      
      // Create match data for both users
      notifyMatchFound(socket.user, bestMatch.user, bestMatch.sharedInterests, matchId, userPreference);
      
      // Remove both users from matchmaking pool
      matchmakingPool.delete(userId);
      matchmakingPool.delete(bestMatch.userId);
      
      // Clear timeouts
      clearMatchmakingTimeouts(userId);
      clearMatchmakingTimeouts(bestMatch.userId);
      
      // Create match acceptance tracking
      activeMatches.set(matchId, {
        users: [userId, bestMatch.userId],
        acceptances: {
          [userId]: false,
          [bestMatch.userId]: false
        },
        sharedInterests: bestMatch.sharedInterests,
        preference: userPreference,
        createdAt: new Date()
      });
      
      // Set timeout for match acceptance
      const timeoutId = setTimeout(() => {
        // Check if match still exists
        if (activeMatches.has(matchId)) {
          const matchData = activeMatches.get(matchId);
          
          // Check which users haven't accepted
          const nonAcceptingUsers = [];
          for (const userId of matchData.users) {
            if (!matchData.acceptances[userId]) {
              nonAcceptingUsers.push(userId);
            }
          }
          
          console.log(`Match ${matchId} timed out. Users who didn't accept: ${nonAcceptingUsers.join(', ')}`);
          
          // Notify all users in the match
          for (const userId of matchData.users) {
              const socketId = connectedUsers.get(userId);
              if (socketId) {
                ioInstance.to(socketId).emit('match:timeout', {
                matchId,
                message: 'Match timed out due to missing acceptances'
              });
            }
          }
          
          // Clean up
          activeMatches.delete(matchId);
        }
      }, MATCH_ACCEPTANCE_TIMEOUT);
      
      // Store timeout IDs for both users
      userTimeouts.set(userId, timeoutId);
      userTimeouts.set(bestMatch.userId, timeoutId);
      
      return;
    } else {
      console.log(`No suitable matches found for user ${userId}`);
      
      // Reset processing flag
      userPoolData.isBeingProcessed = false;
      matchmakingPool.set(userId, userPoolData);
      
      // If we should force a bot match, create one
      if (forceBotMatch) {
        createBotMatchForUser(socket);
        return;
      }
      
      // Otherwise, notify the user that no match was found
      socket.emit('match:notFound', { message: 'No suitable matches found at this time. Try again later.' });
      
      // Keep user in pool for future matches
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
    
    // If we should force a bot match, create one despite the error
    if (forceBotMatch) {
      try {
        createBotMatchForUser(socket);
      } catch (botError) {
        console.error('Error creating forced bot match after error:', botError);
      }
    }
  }
};

/**
 * Create a bot match for a user
 * @param {object} socket - User's socket connection
 * @returns {Promise<boolean>} Success indicator
 */
const createBotMatchForUser = async (socket) => {
  try {
    const userId = socket.user.id;
    const userPreference = socket.user.preference || 'Friendship';
    
    console.log(`Creating bot match for user ${userId} with preference ${userPreference}`);
    
    // Define gender based on user's preference and gender
    let botGender;
    const userGender = socket.user.gender?.toLowerCase() || 'male';
    
    // Define LGBTQ+ gender categories
    const lgbtqGenderCategories = [
      'transgender', 'trans', 'non-binary', 'nonbinary', 'genderqueer', 
      'genderfluid', 'agender', 'bigender', 'two-spirit', 'third-gender',
      'queer', 'questioning', 'intersex', 'other'
    ];
    
    const isUserLgbtq = lgbtqGenderCategories.includes(userGender);
    
    if (userPreference === 'Dating') {
      if (userGender === 'male') {
        botGender = 'female';
      } else if (userGender === 'female') {
        botGender = 'male';
      } else if (isUserLgbtq) {
        // LGBTQ+ users get matched with LGBTQ+ bots
        botGender = lgbtqGenderCategories[Math.floor(Math.random() * lgbtqGenderCategories.length)];
      } else {
        // Default case
        botGender = 'female';
      }
    } else {
      // For Friendship
      if (isUserLgbtq) {
        // LGBTQ+ users for friendship get matched with LGBTQ+ bots
        botGender = lgbtqGenderCategories[Math.floor(Math.random() * lgbtqGenderCategories.length)];
      } else {
        // Non-LGBTQ+ users can get any gender for friendship
        const genders = ['male', 'female'];
        botGender = genders[Math.floor(Math.random() * genders.length)];
      }
    }
    
    // Import the necessary services directly to avoid circular dependencies
    const { generateBotProfile, verifyAndRecoverBotUser, createBotUserRecord } = require('../services/ai/botProfileService');
    
    let botProfile = null;
    let botCreationAttempts = 0;
    const maxBotCreationAttempts = 3;
    
    // Keep trying to create a bot until successful or max attempts reached
    while (!botProfile && botCreationAttempts < maxBotCreationAttempts) {
    try {
      // Generate a bot profile matching user's preferences
        botProfile = await generateBotProfile(
        botGender, 
        userPreference, 
        socket.user.interests || []
      );
        
        // Add explicit date_of_birth if missing
        if (!botProfile.date_of_birth) {
          const randomAge = Math.floor(Math.random() * 15) + 20; // 20-35 years old
          const today = new Date();
          const birthYear = today.getFullYear() - randomAge;
          const birthMonth = Math.floor(Math.random() * 12);
          const birthDay = Math.floor(Math.random() * 28) + 1;
          botProfile.date_of_birth = `${birthYear}-${String(birthMonth + 1).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`;
          console.log(`Added missing date_of_birth to bot: ${botProfile.date_of_birth}`);
        }
        
        // Explicitly create the bot user in the database
        try {
          await createBotUserRecord(botProfile);
          console.log(`Successfully created bot user ${botProfile.id} in database`);
        } catch (createError) {
          console.error(`Error creating bot user record: ${createError.message}`);
          
          // Try verification/recovery as a fallback
          try {
            await verifyAndRecoverBotUser(botProfile);
            console.log(`Successfully recovered bot user ${botProfile.id} after failed creation`);
          } catch (verifyError) {
            console.error(`Bot user verification also failed: ${verifyError.message}`);
            throw new Error(`Could not create or verify bot user: ${verifyError.message}`);
          }
        }
      } catch (error) {
        botCreationAttempts++;
        console.error(`Bot creation attempt ${botCreationAttempts}/${maxBotCreationAttempts} failed: ${error.message}`);
        
        // Sleep between attempts
        if (botCreationAttempts < maxBotCreationAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          console.error(`Failed to create bot after ${maxBotCreationAttempts} attempts`);
          
          // If all attempts fail, create a minimal bot profile as a last resort
          botProfile = {
            id: uuidv4(),
            firstName: botGender === 'female' ? 'Sarah' : 'David',
            lastName: 'Smith',
            username: botGender === 'female' ? 'sarah_smith' : 'david_smith',
            gender: botGender,
            bio: `Hi! I'm ${botGender === 'female' ? 'Sarah' : 'David'}. Nice to meet you!`,
            interests: socket.user.interests ? [...socket.user.interests] : ['Travel', 'Music', 'Movies'],
            date_of_birth: '2000-01-01',
            profile_picture_url: botGender === 'female' 
              ? `https://randomuser.me/api/portraits/women/${Math.floor(Math.random() * 99)}.jpg`
              : `https://randomuser.me/api/portraits/men/${Math.floor(Math.random() * 99)}.jpg`,
            isBot: true,
            is_bot: true,
            preference: userPreference
          };
          
          // Try one last database creation
          try {
            await createBotUserRecord(botProfile);
            console.log(`Created emergency fallback bot user ${botProfile.id}`);
          } catch (finalError) {
            console.error(`Even fallback bot creation failed: ${finalError.message}`);
            // Continue anyway with in-memory only bot
          }
        }
      }
    }
    
    if (!botProfile) {
      throw new Error('Failed to create valid bot profile after multiple attempts');
    }
      
      // Generate a matchId and create the match
      const matchId = uuidv4();
      
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
      first_name: botProfile.firstName || botProfile.first_name,
      last_name: botProfile.lastName || botProfile.last_name,
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
      
      // Reset processing flag if user was in pool
      if (matchmakingPool.has(userId)) {
        const userPoolData = matchmakingPool.get(userId);
        userPoolData.isBeingProcessed = false;
        matchmakingPool.set(userId, userPoolData);
      }
      
    // Create match in database with retries
    let matchCreated = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!matchCreated && retryCount < maxRetries) {
      try {
        // First verify bot user exists in database before creating match
        // This double-check helps prevent foreign key constraint violations
        const { data: botUserExists } = await supabase
          .from('users')
          .select('id')
          .eq('id', botProfile.id)
          .single();
          
        if (!botUserExists) {
          throw new Error(`Bot user ${botProfile.id} not found in database before match creation`);
        }
        
        // Now create the match
        const result = await createMatchInDatabase(matchId, userId, botProfile.id);
        
        if (result && result.success) {
          matchCreated = true;
          console.log(`Successfully created bot match ${matchId} in database (attempt ${retryCount + 1})`);
        } else {
          throw new Error((result && result.error) ? result.error.message : 'Unknown error creating match');
        }
      } catch (dbError) {
        retryCount++;
        error(`Error creating bot match in database (attempt ${retryCount}/${maxRetries}): ${dbError.message}`);
        
        if (retryCount >= maxRetries) {
          console.error(`Maximum retries reached for creating match ${matchId} in database.`);
          
          // If all database attempts failed, we'll continue with in-memory match only
          console.warn(`Proceeding with in-memory match only for matchId ${matchId}`);
        } else {
          // Try to fix the bot user before retrying
          try {
            await verifyAndRecoverBotUser(botProfile);
            console.log(`Repaired bot user ${botProfile.id} before retry ${retryCount+1}`);
            
            // Wait briefly before retrying
            await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
          } catch (repairError) {
            console.error(`Failed to repair bot user: ${repairError.message}`);
          }
        }
      }
      }
      
      // Notify user of the match
      const userMatchData = createMatchData(botAsUser, sharedInterests, matchId, userPreference);
      socket.emit('match:found', { match: userMatchData });
      
      console.log(`Created AI bot match ${matchId} between user ${userId} and bot ${botProfile.id}`);
      
    // Add initial welcome message after a short delay to make it look more natural
    setTimeout(async () => {
      try {
        // Send typing indicator
        const userSocketId = connectedUsers.get(userId);
        if (userSocketId) {
          ioInstance.to(userSocketId).emit('match:typing', {
            matchId: matchId,
            senderId: botProfile.id,
            typing: true
          });
        }
        
        // Wait a bit before sending the message (simulating typing)
        setTimeout(async () => {
          // Generate welcome messages based on preference
          const welcomeMessages = userPreference === 'Dating' ? [
            `Hi there! I'm ${botProfile.first_name || botProfile.firstName}. Your profile caught my eye. How's your day going?`,
            `Hey! I'm excited we matched. What are you looking for on this app?`,
            `Hello! I liked your interests. I'm into ${botProfile.interests[0]} too. What do you enjoy most about it?`,
            `Hi! Nice to connect with you. What made you swipe right on my profile?`,
            `Hey there! I'm ${botProfile.first_name || botProfile.firstName}. What's something interesting about you that's not in your profile?`
          ] : [
            `Hi there! I'm ${botProfile.first_name || botProfile.firstName}. Always looking to make new friends. What brings you to this app?`,
            `Hey! I see we both like ${sharedInterests[0] || botProfile.interests[0]}. What else are you into?`,
            `Hello! I'm new to this area. Any recommendations for good places to hang out?`,
            `Hi! Nice to connect with someone new. What do you usually do for fun on weekends?`,
            `Hey there! I'm ${botProfile.first_name || botProfile.firstName}. I'm always excited to meet new people. Tell me a bit about yourself!`
          ];
          
          const welcomeMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
          
          // Generate message ID
          const messageId = uuidv4();
          const timestamp = new Date().toISOString();
          
          // Create message object
          const messageObject = {
            id: messageId,
            matchId: matchId,
            senderId: botProfile.id,
            senderName: `${botProfile.firstName || botProfile.first_name} ${botProfile.lastName || botProfile.last_name}`,
            message: welcomeMessage,
            timestamp,
            isDelivered: true
          };
          
          // Store message in bot match history
          const botMatch = botMatches.get(matchId);
          if (botMatch) {
            botMatch.messages.push({
              senderId: botProfile.id,
              message: welcomeMessage,
              timestamp
            });
          }
          
          // Stop typing indicator
          if (userSocketId) {
            ioInstance.to(userSocketId).emit('match:typing', {
              matchId: matchId,
              senderId: botProfile.id,
              typing: false
            });
            
            // Send welcome message with slight delay after typing stops
            setTimeout(() => {
              ioInstance.to(userSocketId).emit('match:message', messageObject);
              
              // Send delivery status
              ioInstance.to(userSocketId).emit('match:messageDeliveryStatus', {
                messageId: messageId,
                matchId: matchId,
                deliveryStatus: 'delivered',
                deliveredAt: timestamp
              });
              
              // Try to store the message in database
              try {
                const { storeBotMessage } = require('../services/ai/botProfileService');
                storeBotMessage(botProfile.id, userId, welcomeMessage)
                  .then(() => console.log(`Stored welcome message in database for match ${matchId}`))
                  .catch(err => console.error(`Failed to store welcome message: ${err.message}`));
              } catch (msgError) {
                console.error(`Error storing welcome message: ${msgError.message}`);
              }
            }, 200);
          }
        }, 1500 + Math.random() * 2000); // 1.5-3.5 seconds of "typing"
      } catch (welcomeError) {
        console.error(`Error sending welcome message: ${welcomeError.message}`);
      }
    }, 2000 + Math.random() * 3000); // 2-5 seconds after match
    
    return true;
  } catch (error) {
    console.error(`Error in createBotMatchForUser: ${error.message}`);
    return false;
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

/**
 * Handle bot responses to user messages with improved verification and reliability
 * @param {string} matchId - Match ID
 * @param {string} userMessage - Message from user
 * @param {object} socket - User's socket
 * @param {boolean} isRetry - Whether this is a retry attempt
 * @param {number} retryCount - Number of retry attempts so far
 */
const handleBotResponse = async (matchId, userMessage, socket, isRetry = false, retryCount = 0) => {
  try {
    // Get bot match data
    const botMatch = botMatches.get(matchId);
    if (!botMatch) {
      console.error(`Bot match ${matchId} not found`);
      return;
    }
    
    // Get the user ID from the socket
    const userId = socket.user.id;
    
    // Log the bot match details
    info(`Processing ${isRetry ? 'RETRY ' : ''}bot response for match ${matchId} - Bot ID: ${botMatch.botProfile.id}, User ID: ${userId}`);
    
    // Ensure the bot match has the correct user ID
    if (botMatch.userId !== userId) {
      info(`Updating bot match ${matchId} with correct user ID from ${botMatch.userId} to ${userId}`);
      botMatch.userId = userId;
      botMatches.set(matchId, botMatch);
    }
    
    // Import directly here to avoid circular dependencies
    const { generateBotResponse, storeBotMessage, verifyAndRecoverBotUser } = require('../services/ai/botProfileService');
    
    // Verify bot user exists in database
    try {
      await verifyAndRecoverBotUser(botMatch.botProfile);
      info(`Verified bot ${botMatch.botProfile.id} exists for match ${matchId}`);
    } catch (verifyError) {
      error(`Error verifying bot user: ${verifyError.message}. Will try to continue anyway.`);
      // Continue despite error - the bot might still work in memory
    }
    
    // Add user message to match history if this is not a retry
    if (!isRetry) {
      botMatch.messages.push({
        senderId: userId,
        message: userMessage,
        timestamp: new Date().toISOString()
      });
      // Save updated messages
      botMatches.set(matchId, botMatch);
    }
    
    // Make sure the socket ID mapping is correct
    if (!connectedUsers.has(userId)) {
      info(`User ${userId} not found in connectedUsers map. Adding socket ID ${socket.id}`);
      connectedUsers.set(userId, socket.id);
    } else if (connectedUsers.get(userId) !== socket.id) {
      info(`Updating socket ID for user ${userId} from ${connectedUsers.get(userId)} to ${socket.id}`);
      connectedUsers.set(userId, socket.id);
    }
    
    // Get the socket ID for this user
    const userSocketId = connectedUsers.get(userId);
    info(`User socket ID for ${userId}: ${userSocketId}`);
    
    if (!userSocketId) {
      error(`Could not find socket ID for user ${userId}. Falling back to socket.id: ${socket.id}`);
      // If no socket ID in map, use the current socket ID as fallback
      connectedUsers.set(userId, socket.id);
    }
    
    // Double-check that we have a valid socket
    const targetSocketId = userSocketId || socket.id;
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    
    if (!targetSocket) {
      error(`Socket ${targetSocketId} not found in io.sockets.sockets map. Will use direct socket object.`);
      // We'll use socket parameter directly as fallback
    }
    
    // Send typing indicator to user for better UX
    try {
      // Try sending to socket directly first
      socket.emit('match:typing', {
        matchId: matchId,
        senderId: botMatch.botProfile.id,
        typing: true
      });
      
      // Also try with global socket instance if different
      if (targetSocket && targetSocket.id !== socket.id) {
        targetSocket.emit('match:typing', {
          matchId: matchId,
          senderId: botMatch.botProfile.id,
          typing: true
        });
      }
      
      info(`Sent typing indicator to user ${userId} for bot ${botMatch.botProfile.id}`);
    } catch (typingError) {
      error(`Error sending typing indicator: ${typingError.message}`);
      // Continue despite error
    }
    
    // Generate a "thinking time" delay based on message complexity
    // Shorter delay for direct AI responses while still appearing human-like
    const thinkingDelay = Math.min(300 + (userMessage.length * 5), 1500);
    
    // For retries, use much shorter delays
    const responseDelay = isRetry ? 300 : thinkingDelay;
    
    info(`Bot will respond in ${responseDelay}ms with a${isRetry ? ' retry' : ''} realistic typing delay`);
    
    try {
      // Start AI response generation immediately (don't wait for typing animation)
      const botResponsePromise = generateBotResponse(
        userMessage,
        botMatch.botProfile,
        botMatch.preference,
        userId // Pass user ID for database storage
      );
      
      // Calculate a realistic typing time based on typical human typing speed
      // Average person types 40 WPM, or about 200 characters per minute (3.33 chars/sec)
      // So we'll use 300ms per character as a baseline
      const estimateResponseLength = 100; // Assume average response is ~100 chars
      const typingTime = Math.min(1000 + (estimateResponseLength * 30), 5000); // 1-5 seconds
      
      // Wait for thinking delay to simulate the bot "reading" the message
      await new Promise(resolve => setTimeout(resolve, responseDelay));
      
      // Get bot response from AI - will execute in parallel with typing animation
      info(`Generating AI response for user ${userId} from bot ${botMatch.botProfile.id}`);
      const botResponse = await botResponsePromise;
      info(`Generated bot response: "${botResponse}"`);
      
      // Calculate actual typing time based on real response length
      const actualTypingTime = Math.min(500 + (botResponse.length * 30), 4000);
      
      // Send typing indicator for the calculated duration
      const typingEndTime = Date.now() + actualTypingTime;
        
      // Generate a message ID for the bot's response
      const botMessageId = uuidv4();
      const timestamp = new Date().toISOString();
        
      // Prepare the message object
      const messageObject = {
        id: botMessageId,
        matchId: matchId,
        senderId: botMatch.botProfile.id,
        senderName: `${botMatch.botProfile.firstName || botMatch.botProfile.first_name} ${botMatch.botProfile.lastName || botMatch.botProfile.last_name}`,
        message: botResponse,
        timestamp,
        isDelivered: true
      };
        
      // Add bot message to match history
      botMatch.messages.push({
        senderId: botMatch.botProfile.id,
        message: botResponse,
        timestamp,
        id: botMessageId
      });
      
      // Save updated messages
      botMatches.set(matchId, botMatch);
      
      // Wait for typing animation to complete
      const remainingTypingTime = typingEndTime - Date.now();
      if (remainingTypingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTypingTime));
      }
      
      // Stop typing indicator
      try {
        // Try multiple ways to ensure the typing indicator stops
        socket.emit('match:typing', {
          matchId: matchId,
          senderId: botMatch.botProfile.id,
          typing: false
        });
        
        if (targetSocket && targetSocket.id !== socket.id) {
          targetSocket.emit('match:typing', {
            matchId: matchId,
            senderId: botMatch.botProfile.id,
            typing: false
          });
        }
        
        if (ioInstance) {
          ioInstance.to(targetSocketId).emit('match:typing', {
            matchId: matchId,
            senderId: botMatch.botProfile.id,
            typing: false
          });
        }
        
        info(`Stopped typing indicator for bot ${botMatch.botProfile.id}`);
      } catch (stopTypingError) {
        error(`Error stopping typing indicator: ${stopTypingError.message}`);
        // Continue despite error
      }
      
      // Small delay after typing stops before message appears (realistic)
      setTimeout(() => {
        try {
          // Try multiple ways to ensure the message is delivered
          info(`Sending bot message to user ${userId} through socket ${targetSocketId}`);
          
          // Method 1: Direct socket emit
          socket.emit('match:message', messageObject);
          
          // Method 2: Target socket if different
          if (targetSocket && targetSocket.id !== socket.id) {
            targetSocket.emit('match:message', messageObject);
          }
          
          // Method 3: Global io instance
          if (ioInstance) {
            ioInstance.to(targetSocketId).emit('match:message', messageObject);
          }
          
          info(`Successfully sent bot message to user ${userId}`);
            
          // Also store delivery status information for consistency with real messages
          const deliveryStatusObject = {
            messageId: botMessageId,
            matchId: matchId,
            deliveryStatus: 'delivered',
            deliveredAt: new Date().toISOString()
          };
          
          // Send delivery status using all methods
          socket.emit('match:messageDeliveryStatus', deliveryStatusObject);
          
          if (targetSocket && targetSocket.id !== socket.id) {
            targetSocket.emit('match:messageDeliveryStatus', deliveryStatusObject);
          }
          
          if (ioInstance) {
            ioInstance.to(targetSocketId).emit('match:messageDeliveryStatus', deliveryStatusObject);
          }
            
          // After a short delay, mark the message as read (looks more realistic)
          setTimeout(() => {
            const readStatusObject = {
              messageId: botMessageId,
              matchId: matchId,
              readAt: new Date().toISOString()
            };
            
            // Send read status using all methods
            socket.emit('match:messageRead', readStatusObject);
            
            if (targetSocket && targetSocket.id !== socket.id) {
              targetSocket.emit('match:messageRead', readStatusObject);
            }
            
            if (ioInstance) {
              ioInstance.to(targetSocketId).emit('match:messageRead', readStatusObject);
            }
          }, 800 + Math.random() * 1200); // 800-2000ms delay
            
          // Mark response as sent successfully
          info(`Bot response successfully delivered for match ${matchId}`);
          
          // Store message in database for persistence
          try {
            storeBotMessage(botMatch.botProfile.id, userId, botResponse)
              .then(() => info(`Successfully stored bot message in database`))
              .catch(dbError => error(`Failed to store bot message in database: ${dbError.message}`));
          } catch (storeError) {
            error(`Error storing bot message: ${storeError.message}`);
            // Continue despite error
          }
        } catch (sendError) {
          error(`Error sending bot message: ${sendError.message}`);
            
          // Retry if error occurs during sending
          if (!isRetry && retryCount < 2) {
            info(`Will retry sending bot message (attempt ${retryCount + 1})`);
            setTimeout(() => {
              handleBotResponse(matchId, userMessage, socket, true, retryCount + 1);
            }, 1000);
          }
        }
      }, 200 + Math.random() * 300); // 200-500ms delay
    } catch (responseError) {
      error(`Error in bot response: ${responseError.message}`);
      
      // Retry logic - if response fails and this is not already a retry
      if (!isRetry && retryCount < 2) {
        info(`Retrying bot response for match ${matchId} (attempt ${retryCount + 1})`);
        
        // Wait a bit before retrying
        setTimeout(() => {
          handleBotResponse(matchId, userMessage, socket, true, retryCount + 1);
        }, 2000);
      } else if (isRetry && retryCount >= 2) {
        error(`Max retries reached for bot response in match ${matchId}`);
        
        // Send an emergency message as last resort
        try {
          // Stop typing first
          socket.emit('match:typing', {
            matchId: matchId,
            senderId: botMatch.botProfile.id,
            typing: false
          });
          
          // Send emergency message
          const emergencyMessageId = uuidv4();
          const emergencyMessage = {
            id: emergencyMessageId,
            matchId: matchId,
            senderId: botMatch.botProfile.id,
            senderName: `${botMatch.botProfile.firstName || botMatch.botProfile.first_name} ${botMatch.botProfile.lastName || botMatch.botProfile.last_name}`,
            message: "I'd love to hear more about your interests! What do you enjoy doing in your free time?",
            timestamp: new Date().toISOString(),
            isDelivered: true
          };
          
          socket.emit('match:message', emergencyMessage);
          info(`Sent emergency fallback message to user ${userId}`);
          
          // Add to match history
          botMatch.messages.push({
            senderId: botMatch.botProfile.id,
            message: emergencyMessage.message,
            timestamp: emergencyMessage.timestamp,
            id: emergencyMessageId
          });
          
          // Save updated messages
          botMatches.set(matchId, botMatch);
        } catch (emergencyError) {
          error(`Error sending emergency message: ${emergencyError.message}`);
        }
      }
    }
  } catch (err) {
    error(`Unexpected error in handleBotResponse: ${err.message}`);
  }
};

// Export essential functions
module.exports = {
  initializeSocket,
  notifyMessageDeletion,
  notifyBulkMessageDeletion,
  notifyConversationDeleted,
  handleBotResponse,
  cleanupUserMatches,
  updateUserOnlineStatus,
  createMatchInDatabase,
  findMatchForUser,
  createBotMatchForUser,
  createMatchData,
  notifyMatchFound,
  findMatchesForAllUsers,
  startGlobalMatchmaking,
  stopGlobalMatchmaking,
  cleanMatchmakingPool,
  clearMatchmakingTimeouts,
  clearBotChat: (userId, botId) => {
    try {
      // Import function to clear bot conversation history
      const { clearBotConversationHistory } = require('../services/ai/botProfileService');
      
      // Clear the conversation history
      clearBotConversationHistory(userId, botId);
      
      // Return success status
      return { success: true, message: 'Bot chat history cleared' };
    } catch (error) {
      console.error(`Error clearing bot chat: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}; 