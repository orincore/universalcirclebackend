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
  // Store reference to io instance
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
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id} (${socket.user.username})`);
    
    // Add user to connected users map
    connectedUsers.set(socket.user.id, socket.id);
    
    // Update user's online status in database
    updateUserOnlineStatus(socket.user.id, true);
    
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
            firstName: socket.user.first_name,
            lastName: socket.user.last_name,
            username: socket.user.username,
            profilePictureUrl: socket.user.profile_picture_url
          };
          
          // Get the receiver's current online status
          const isReceiverOnline = connectedUsers.has(receiverId);
          
          // Emit message to sender with delivery status info
          socket.emit('message:sent', {
            ...message,
            tempId: tempMessageId, // Include temp ID for client reference
            deliveryStatus: isReceiverOnline ? 'delivered' : 'sent',
            timestamp: new Date().toISOString()
          });
          
          // Update connection health metrics
          if (socket.connectionStability) {
            socket.connectionStability.lastMessageTime = Date.now();
            socket.connectionStability.messagesSinceReconnect++;
            socket.connectionStability.connectionHealth = Math.min(100, 
              socket.connectionStability.connectionHealth + 5);
          }
          
          // Execute callback if provided
          if (typeof callback === 'function') {
            callback({ 
              success: true, 
              message: { 
                id: message.id,
                tempId: tempMessageId, // Include temp ID for client reference
                deliveryStatus: isReceiverOnline ? 'delivered' : 'sent'
              }
            });
          }
          
          // Emit message to receiver if online
          const receiverSocketId = connectedUsers.get(receiverId);
          if (receiverSocketId) {
            const receiverSocket = io.sockets.sockets.get(receiverSocketId);
            if (receiverSocket) {
              // Add to receiver's active conversations
              if (!receiverSocket.activeConversations) {
                receiverSocket.activeConversations = new Set();
              }
              receiverSocket.activeConversations.add(senderId);
              
              // Send with acknowledgment to confirm delivery
              receiverSocket.emit('message:received', message, (ack) => {
                if (ack && ack.received) {
                  // Update sender with confirmation that message was actually delivered
                  socket.emit('message:delivered', {
                    messageId: message.id,
                    tempId: tempMessageId,
                    deliveredAt: new Date().toISOString()
                  });
                }
              });
              
              // Update receiver's connection health metrics
              if (receiverSocket.connectionStability) {
                receiverSocket.connectionStability.lastMessageTime = Date.now();
                receiverSocket.connectionStability.messagesSinceReconnect++;
                receiverSocket.connectionStability.connectionHealth = Math.min(100, 
                  receiverSocket.connectionStability.connectionHealth + 5);
              }
            } else {
              // Socket ID exists but socket is invalid, clean up
              connectedUsers.delete(receiverId);
            }
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
    socket.on('match:message', (data, callback) => {
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
        
        // Add to in-memory store or database here if needed for persistence
        
        // Emit the message to the match room
        socket.to(matchId).emit('match:message', messageObject);
        
        // Send confirmation to sender with delivery info
        socket.emit('match:messageSent', {
          ...messageObject,
          matchId,
          deliveryStatus: wasDelivered ? 'delivered' : 'sent',
          recipientCount: Math.max(0, roomSize - 1) // Number of recipients
        });
        
        // Provide callback response if client is listening for it
        if (typeof callback === 'function') {
          callback({
            success: true,
            messageId,
            deliveryStatus: wasDelivered ? 'delivered' : 'sent',
            recipientCount: Math.max(0, roomSize - 1)
          });
        }
      } catch (error) {
        console.error('Error sending match message:', error);
        const errorData = { 
          source: 'match:message',
          message: 'Failed to send message', 
          details: error.message 
        };
        socket.emit('error', errorData);
        
        if (typeof callback === 'function') {
          callback({ success: false, error: errorData });
        }
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
    
    // Map frontend 'match:accepted' to the backend 'accept_match' handling
    socket.on('match:accepted', ({ matchId }) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} accepted match ${matchId} using match:accepted event`);
        
        if (!activeMatches.has(matchId)) {
          socket.emit('error', {
            source: 'match:accepted',
            message: 'Match not found'
          });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        
        // Update acceptance status
        matchData.acceptances[userId] = true;
        activeMatches.set(matchId, matchData);
        
        // Check if both users accepted
        const bothAccepted = Object.values(matchData.acceptances).every(status => status === true);
        
        if (bothAccepted) {
          console.log(`Match ${matchId} accepted by both users! Creating chat room with ID: ${matchId}`);
          
          // Get both user ids
          const [user1Id, user2Id] = matchData.users;
          
          // Create the match in the database
          createMatchInDatabase(matchId, user1Id, user2Id);
          
          // Create a chat room for the match
          const roomId = matchId;
          
          // Emit match connected to both users
          matchData.users.forEach(userId => {
            const socketId = connectedUsers.get(userId);
            if (socketId) {
              const socketInstance = io.sockets.sockets.get(socketId);
              if (socketInstance) {
                // Join the private chat room
                socketInstance.join(roomId);
                console.log(`User ${userId} joined chat room ${roomId} via match:accept event`);
              }
              
              const otherUserId = userId === user1Id ? user2Id : user1Id;
              io.to(socketId).emit('match:confirmed', {
                matchId,
                roomId,
                otherUserId,
                status: 'connected'
              });
            }
          });
          
          // Clean up
          activeMatches.delete(matchId);
        } else {
          // Notify the user that we're waiting for the other user
          socket.emit('match:waiting', {
            matchId,
            message: 'Waiting for the other user to accept'
          });
        }
      } catch (error) {
        console.error('Error accepting match:', error);
        socket.emit('error', {
          source: 'match:accepted',
          message: 'Error accepting match'
        });
      }
    });
    
    // Map frontend 'match:rejected' to the backend 'reject_match' handling
    socket.on('match:rejected', ({ matchId }) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} rejected match ${matchId} using match:rejected event`);
        
        if (!activeMatches.has(matchId)) {
          socket.emit('error', {
            source: 'match:rejected',
            message: 'Match not found'
          });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        
        // Notify both users about the rejection
        matchData.users.forEach(userId => {
          const socketId = connectedUsers.get(userId);
          if (socketId) {
            io.to(socketId).emit('match:rejected', {
              matchId,
              message: 'Match was rejected'
            });
          }
        });
        
        // Clean up
        activeMatches.delete(matchId);
        
        // Put both users back in the matchmaking pool after a short delay
        setTimeout(() => {
          matchData.users.forEach(userId => {
            const socketId = connectedUsers.get(userId);
            if (socketId && connectedUsers.has(userId)) {
              const userSocket = io.sockets.sockets.get(socketId);
              if (userSocket) {
                // Add user back to matchmaking pool
                matchmakingPool.set(userId, {
                  userId,
                  socketId,
                  user: userSocket.user,
                  interests: userSocket.user.interests,
                  joinedAt: new Date()
                });
                
                // Notify user about restarting matchmaking
                io.to(socketId).emit('match:waiting', { 
                  message: 'Other user declined. Searching for a new match...' 
                });
                
                // Restart matchmaking for this user
                findMatchForUser(userSocket);
              }
            }
          });
        }, 1000);
      } catch (error) {
        console.error('Error rejecting match:', error);
        socket.emit('error', {
          source: 'match:rejected',
          message: 'Error rejecting match'
        });
      }
    });
    
    // Handle match restart
    socket.on('match:restart', (criteria = {}) => {
      try {
        // Simply call findRandomMatch again
        socket.emit('findRandomMatch', criteria);
      } catch (error) {
        console.error('Error restarting matchmaking:', error);
        socket.emit('error', {
          source: 'match:restart',
          message: 'Error restarting matchmaking'
        });
      }
    });
    
    // Handle match acceptance
    socket.on('match:accept', ({ matchId }) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} accepted match ${matchId}`);
        
        if (!activeMatches.has(matchId)) {
          console.log(`Match ${matchId} not found in activeMatches map`);
          socket.emit('error', {
            message: 'Match not found'
          });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        console.log(`Match data retrieved for ${matchId}:`, JSON.stringify(matchData));
        
        // Ensure the acceptances object exists
        if (!matchData.acceptances) {
          console.log(`Match ${matchId} does not have acceptances object, creating it`);
          matchData.acceptances = {};
        }
        
        // Update acceptance status
        matchData.acceptances[userId] = true;
        activeMatches.set(matchId, matchData);
        
        // Get the other user ID
        const otherUserId = matchData.users.find(id => id !== userId);
        if (!otherUserId) {
          console.log(`Could not find other user in match ${matchId}`);
          socket.emit('error', {
            message: 'Match data is invalid'
          });
          return;
        }
        
        const otherUserSocketId = connectedUsers.get(otherUserId);
        
        // Notify the other user about this user's acceptance
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('match:userAccepted', {
            matchId,
            userId,
            message: 'The other user has accepted the match'
          });
        }
        
        // Check if both users accepted
        const bothAccepted = Object.values(matchData.acceptances).every(status => status === true);
        
        if (bothAccepted) {
          console.log(`Match ${matchId} accepted by both users! Creating chat room with ID: ${matchId}`);
          
          // Get both user ids
          const [user1Id, user2Id] = matchData.users;
          
          // Create the match in the database
          createMatchInDatabase(matchId, user1Id, user2Id);
          
          // Create a chat room for the match
          const roomId = matchId;
          
          // Emit match confirmed to both users
          matchData.users.forEach(userId => {
            const socketId = connectedUsers.get(userId);
            if (socketId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                // Join the private chat room
                socket.join(roomId);
                console.log(`User ${userId} joined chat room ${roomId} via match:accept event`);
                
                // Get other user ID for this user
                const otherUserId = userId === user1Id ? user2Id : user1Id;
                
                // Send confirmation with chat room details
                io.to(socketId).emit('match:confirmed', {
                  matchId,
                  roomId,
                  otherUserId,
                  status: 'connected'
                });
              }
            }
          });
          
          // Clean up
          activeMatches.delete(matchId);
          
          // Clear any pending timeouts
          clearMatchmakingTimeouts(user1Id);
          clearMatchmakingTimeouts(user2Id);
        } else {
          // Notify the user that we're waiting for the other user
          socket.emit('match:waiting', {
            matchId,
            message: 'Waiting for the other user to accept'
          });
        }
      } catch (error) {
        console.error('Error handling match acceptance:', error);
        socket.emit('error', {
          message: 'Error processing your response'
        });
      }
    });
    
    // Handle match rejection
    socket.on('match:reject', ({ matchId }) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} rejected match ${matchId}`);
        
        if (!activeMatches.has(matchId)) {
          socket.emit('error', {
            message: 'Match not found'
          });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        
        // Get the other user ID
        const otherUserId = matchData.users.find(id => id !== userId);
        const otherUserSocketId = connectedUsers.get(otherUserId);
        
        // Notify the other user about the rejection
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('match:rejected', {
              matchId,
            rejectedBy: userId,
            message: 'The other user rejected the match'
            });
          }
        
        // Clean up
        activeMatches.delete(matchId);
        
        // Put both users back in the matchmaking pool after a short delay
        setTimeout(() => {
          // Handle current user
          if (connectedUsers.has(userId)) {
            const userSocket = io.sockets.sockets.get(socket.id);
            if (userSocket) {
              matchmakingPool.set(userId, {
                userId,
                socketId: socket.id,
                user: socket.user,
                interests: socket.user.interests,
                joinedAt: new Date()
              });
              
              socket.emit('match:waiting', { message: 'Searching for a new match...' });
              findMatchForUser(userSocket);
              console.log(`Restarted matchmaking for user ${userId} after rejection`);
            }
          }
          
          // Handle other user
          if (otherUserSocketId && connectedUsers.has(otherUserId)) {
            const otherSocket = io.sockets.sockets.get(otherUserSocketId);
            if (otherSocket) {
              matchmakingPool.set(otherUserId, {
                userId: otherUserId,
                socketId: otherUserSocketId,
                user: otherSocket.user,
                interests: otherSocket.user.interests,
                joinedAt: new Date()
              });
              
              io.to(otherUserSocketId).emit('match:waiting', { 
                message: 'Other user declined. Searching for a new match...' 
              });
              
              findMatchForUser(otherSocket);
              console.log(`Restarted matchmaking for user ${otherUserId} after rejection by ${userId}`);
            }
          }
          
          // Clear any pending timeouts
          clearMatchmakingTimeouts(userId);
          clearMatchmakingTimeouts(otherUserId);
        }, 1000);
      } catch (error) {
        console.error('Error handling match rejection:', error);
        socket.emit('error', {
          message: 'Error processing your response'
        });
      }
    });
    
    // Handle cancel matchmaking
    socket.on('match:cancel', () => {
      const userId = socket.user.id;
      console.log(`User ${userId} cancelled matchmaking`);
      
      // Remove user from matchmaking pool
      matchmakingPool.delete(userId);
      
      // Clear any matchmaking timeouts
      clearMatchmakingTimeouts(userId);
      
      socket.emit('match:cancelled', {
        message: 'Matchmaking cancelled'
      });
    });
    
    // Disconnect handler with cleanup
    socket.on('disconnect', () => {
      const userId = socket.user.id;
      console.log(`User disconnected: ${userId} (${socket.user.username})`);
      
      // Remove user from matchmaking pool
      matchmakingPool.delete(userId);
      
      // Clear any matchmaking timeouts
      clearMatchmakingTimeouts(userId);
      
      // Remove user from connected users map
      connectedUsers.delete(userId);
      
      // Update user's online status in database
      updateUserOnlineStatus(userId, false);
      
      // Handle any active matches
      for (const [matchId, matchData] of activeMatches.entries()) {
        if (matchData.users.includes(userId)) {
          // Notify the other user about disconnection
          const otherUserId = matchData.users.find(id => id !== userId);
          if (otherUserId) {
            const otherSocketId = connectedUsers.get(otherUserId);
            
            if (otherSocketId) {
              io.to(otherSocketId).emit('match:disconnected', {
                matchId,
                message: 'The other user disconnected'
              });
              
              // Put the other user back in matchmaking pool if they're still connected
              const otherUserSocket = io.sockets.sockets.get(otherSocketId);
              if (otherUserSocket) {
                console.log(`Returning user ${otherUserId} to matchmaking pool after match partner disconnected`);
                matchmakingPool.set(otherUserId, {
                  userId: otherUserId,
                  socketId: otherSocketId,
                  user: otherUserSocket.user,
                  interests: otherUserSocket.user.interests,
                  joinedAt: new Date(),
                  isBeingProcessed: false
                });
                
                // Let them know we're searching again
                io.to(otherSocketId).emit('match:waiting', { 
                  message: 'Other user disconnected. Searching for a new match...' 
                });
                
                // Start matchmaking for this user again
                setTimeout(() => {
                  findMatchForUser(otherUserSocket);
                }, 1000);
              }
            }
          }
          
          // Clean up the match
          activeMatches.delete(matchId);
        }
      }
    });

    // Load private conversation messages
    socket.on('messages:load', async (data) => {
      try {
        const { userId, limit = 20, before } = data;
        const currentUserId = socket.user.id;
        
        console.log(`User ${currentUserId} loading messages with user ${userId}`);
        
        // Build query to get messages between the two users
        let query = supabase
          .from('messages')
          .select(`
            id,
            content,
            media_url,
            sender_id,
            receiver_id,
            is_read,
            created_at,
            updated_at
          `)
          .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUserId})`)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        // Add pagination if 'before' timestamp is provided
        if (before) {
          query = query.lt('created_at', before);
        }
        
        const { data: messages, error } = await query;
        
        if (error) {
          console.error('Error loading messages:', error);
          socket.emit('error', {
            source: 'messages:load',
            message: 'Failed to load messages'
          });
          return;
        }
        
        // Get user details for message senders
        const userIds = [...new Set(messages.map(m => m.sender_id))];
        const { data: users, error: userError } = await supabase
          .from('users')
          .select('id, username, first_name, last_name, profile_picture_url')
          .in('id', userIds);
          
        if (userError) {
          console.error('Error loading user details:', userError);
        }
        
        // Create a map of user details for easy lookup
        const userMap = {};
        if (users) {
          users.forEach(user => {
            userMap[user.id] = {
              id: user.id,
              username: user.username,
              firstName: user.first_name,
              lastName: user.last_name,
              profilePictureUrl: user.profile_picture_url
            };
          });
        }
        
        // Add user details to messages
        const messagesWithUsers = messages.map(message => {
          return {
            ...message,
            sender: userMap[message.sender_id] || { id: message.sender_id }
          };
        });
        
        // Check if there are more messages to load
        const hasMore = messages.length === limit;
        
        // Emit response
        socket.emit('messages:loaded', {
          messages: messagesWithUsers,
          hasMore,
          conversationId: userId,
          timestamp: new Date().toISOString()
        });
        
        // Mark messages as read
        if (messages.length > 0) {
          const messagesToMark = messages.filter(m => 
            m.receiver_id === currentUserId && !m.is_read
          );
          
          if (messagesToMark.length > 0) {
            await supabase
              .from('messages')
              .update({ is_read: true, updated_at: new Date() })
              .in('id', messagesToMark.map(m => m.id));
              
            // Notify sender about read messages
            const senderSocketId = connectedUsers.get(userId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('message:allRead', {
                messageIds: messagesToMark.map(m => m.id),
                conversationId: currentUserId,
                readAt: new Date().toISOString(),
                readBy: currentUserId
              });
            }
          }
        }
      } catch (error) {
        console.error('Error in messages:load:', error);
        socket.emit('error', {
          source: 'messages:load',
          message: 'Server error loading messages'
        });
      }
    });
    
    // Load match chat messages
    socket.on('match:loadMessages', async (data) => {
      try {
        const { matchId, limit = 20, before } = data;
        const userId = socket.user.id;
        
        console.log(`User ${userId} loading messages for match ${matchId}`);
        
        // Verify user is part of the match
        const { data: match, error: matchError } = await supabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .single();
          
        if (matchError || !match) {
          console.error('Error finding match:', matchError);
          socket.emit('error', {
            source: 'match:loadMessages',
            message: 'Match not found'
          });
          return;
        }
        
        if (match.user1_id !== userId && match.user2_id !== userId) {
          socket.emit('error', {
            source: 'match:loadMessages',
            message: 'You are not part of this match'
          });
          return;
        }
        
        // Build query to get match messages
        // Note: This assumes you have a match_messages table
        // If not, you may need to adjust this query or create the table
        let query = supabase
          .from('match_messages')
          .select(`
            id,
            match_id,
            user_id,
            content,
            media_url,
            created_at
          `)
          .eq('match_id', matchId)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        // Add pagination if 'before' timestamp is provided
        if (before) {
          query = query.lt('created_at', before);
        }
        
        const { data: messages, error } = await query;
        
        // If the match_messages table doesn't exist or there's another error
        if (error) {
          console.error('Error loading match messages:', error);
          
          // Return an appropriate response even if there's an error
          // This might be the case if match chat messages are stored differently
          socket.emit('match:messagesLoaded', {
            messages: [],
            hasMore: false,
            matchId,
            timestamp: new Date().toISOString(),
            error: 'Could not load messages'
          });
          return;
        }
        
        // Get user details for message senders
        const userIds = [...new Set(messages.map(m => m.user_id))];
        const { data: users, error: userError } = await supabase
          .from('users')
          .select('id, username, first_name, last_name, profile_picture_url')
          .in('id', userIds);
          
        if (userError) {
          console.error('Error loading user details:', userError);
        }
        
        // Create a map of user details for easy lookup
        const userMap = {};
        if (users) {
          users.forEach(user => {
            userMap[user.id] = {
              id: user.id,
              username: user.username,
              firstName: user.first_name,
              lastName: user.last_name,
              profilePictureUrl: user.profile_picture_url
            };
          });
        }
        
        // Add user details to messages
        const messagesWithUsers = messages.map(message => {
          return {
            ...message,
            sender: userMap[message.user_id] || { id: message.user_id }
          };
        });
        
        // Check if there are more messages to load
        const hasMore = messages.length === limit;
        
        // Emit response
        socket.emit('match:messagesLoaded', {
          messages: messagesWithUsers,
          hasMore,
          matchId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error in match:loadMessages:', error);
        socket.emit('error', {
          source: 'match:loadMessages',
          message: 'Server error loading match messages'
        });
      }
    });

    // Add socket event handler for conversation deletion
    socket.on('conversation:delete', async (data) => {
      try {
        const { otherUserId } = data;
        const currentUserId = socket.user.id;
        
        if (!otherUserId) {
          socket.emit('error', {
            source: 'conversation:delete',
            message: 'Other user ID is required'
          });
          return;
        }
        
        console.log(`User ${currentUserId} requested to delete conversation with ${otherUserId}`);
        
        // 1. Delete all messages between the two users
        const { error: deleteMessagesError } = await supabase
          .from('messages')
          .delete()
          .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`);

        if (deleteMessagesError) {
          console.error('Error deleting messages:', deleteMessagesError);
          socket.emit('error', {
            source: 'conversation:delete',
            message: 'Failed to delete messages'
          });
          return;
        }
        
        // 2. Find and update match status to 'removed'
        const { data: match, error: matchFindError } = await supabase
          .from('matches')
          .select('id, status')
          .or(`and(user1_id.eq.${currentUserId},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${currentUserId})`)
          .eq('status', 'accepted')
          .single();

        if (matchFindError && matchFindError.code !== 'PGRST116') { // PGRST116 is "Results contain 0 rows"
          console.error('Error finding match:', matchFindError);
          socket.emit('error', {
            source: 'conversation:delete',
            message: 'Failed to find match'
          });
          return;
        }

        // If match exists, update its status
        if (match) {
          const { error: matchUpdateError } = await supabase
            .from('matches')
            .update({ 
              status: 'removed',
              updated_at: new Date()
            })
            .eq('id', match.id);

          if (matchUpdateError) {
            console.error('Error updating match:', matchUpdateError);
            socket.emit('error', {
              source: 'conversation:delete',
              message: 'Failed to update match status'
            });
            return;
          }
        }
        
        // 3. Notify both users about the conversation deletion
        notifyConversationDeleted(currentUserId, otherUserId);
        
        // 4. Send success confirmation to user who initiated deletion
        socket.emit('conversation:deleteConfirmed', {
          otherUserId,
          timestamp: new Date().toISOString(),
          status: 'success'
        });
        
      } catch (error) {
        console.error('Error in conversation:delete:', error);
        socket.emit('error', {
          source: 'conversation:delete',
          message: 'Server error processing conversation deletion'
        });
      }
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
            
            // Remove from connected users map
            if (connectedUsers.get(socket.user.id) === socket.id) {
              connectedUsers.delete(socket.user.id);
            }
            
            // Clean up any active matches and conversations
            cleanupUserMatches(socket.user.id);
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
    
    // Handle explicit client shutdown/logout
    socket.on('client:logout', async () => {
      try {
        // Immediate status update on explicit logout
        await updateUserOnlineStatus(socket.user.id, false);
        
        // Remove from connected users map
        connectedUsers.delete(socket.user.id);
        
        // Clear any active disconnect timeout
        if (global.disconnectTimeouts && global.disconnectTimeouts.has(socket.user.id)) {
          clearTimeout(global.disconnectTimeouts.get(socket.user.id));
          global.disconnectTimeouts.delete(socket.user.id);
        }
        
        // Emit offline status to other users
        io.emit('user:status', {
          userId: socket.user.id,
          online: false,
          lastSeen: new Date().toISOString()
        });
        
        // Disconnect the socket
        socket.disconnect(true);
      } catch (error) {
        console.error('Error during logout:', error);
      }
    });
    
    // Handle reconnection cancellation
    socket.on('client:reconnected', () => {
      // Clear any pending disconnect timeout
      if (global.disconnectTimeouts && global.disconnectTimeouts.has(socket.user.id)) {
        clearTimeout(global.disconnectTimeouts.get(socket.user.id));
        global.disconnectTimeouts.delete(socket.user.id);
      }
      
      // Update user status
      updateUserOnlineStatus(socket.user.id, true);
      
      // Re-add to connected users map
      connectedUsers.set(socket.user.id, socket.id);
      
      // Re-emit online status to other users
      io.emit('user:status', {
        userId: socket.user.id,
        online: true
      });
    });

    // Initialize chat features for the socket
    socket.chatFeatures = {
      activeConversations: new Set(),
      typingStatus: new Map(),
      messageQueue: new Map(),
      lastMessageTime: Date.now(),
      isTyping: false
    };

    // Handle message sending with real-time delivery
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

        // Add to active conversations
        socket.chatFeatures.activeConversations.add(receiverId);

        // Generate temporary ID for message tracking
        const tempMessageId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Store in message queue
        socket.chatFeatures.messageQueue.set(tempMessageId, {
          receiverId,
          content,
          mediaUrl,
          sequence: currentSequence,
          timestamp: Date.now()
        });

        // Create message in database
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
            sequence: currentSequence
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating message:', error);
          const dbError = { message: 'Failed to send message', details: error.message };
          socket.emit('error', dbError);
          if (typeof callback === 'function') callback({ success: false, error: dbError });
          return;
        }

        // Add sender info to message
        message.sender = {
          id: socket.user.id,
          firstName: socket.user.first_name,
          lastName: socket.user.last_name,
          username: socket.user.username,
          profilePictureUrl: socket.user.profile_picture_url
        };

        // Get receiver's online status
        const isReceiverOnline = connectedUsers.has(receiverId);

        // Emit to sender with delivery status
        socket.emit('message:sent', {
          ...message,
          tempId: tempMessageId,
          deliveryStatus: isReceiverOnline ? 'delivered' : 'sent',
          timestamp: new Date().toISOString()
        });

        // Update connection health
        if (socket.connectionStability) {
          socket.connectionStability.lastMessageTime = Date.now();
          socket.connectionStability.messagesSinceReconnect++;
          socket.connectionStability.connectionHealth = Math.min(100, 
            socket.connectionStability.connectionHealth + 5);
        }

        // Emit to receiver if online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            // Add to receiver's active conversations
            receiverSocket.chatFeatures.activeConversations.add(senderId);

            // Send with acknowledgment
            receiverSocket.emit('message:received', message, (ack) => {
              if (ack && ack.received) {
                // Update sender with delivery confirmation
                socket.emit('message:delivered', {
                  messageId: message.id,
                  tempId: tempMessageId,
                  deliveredAt: new Date().toISOString()
                });

                // Update message in database
                supabase
                  .from('messages')
                  .update({ delivered_at: new Date() })
                  .eq('id', message.id);
              }
            });

            // Update receiver's connection health
            if (receiverSocket.connectionStability) {
              receiverSocket.connectionStability.lastMessageTime = Date.now();
              receiverSocket.connectionStability.messagesSinceReconnect++;
              receiverSocket.connectionStability.connectionHealth = Math.min(100, 
                receiverSocket.connectionStability.connectionHealth + 5);
            }
          }
        }

        // Remove from message queue after successful delivery
        socket.chatFeatures.messageQueue.delete(tempMessageId);

        // Execute callback
        if (typeof callback === 'function') {
          callback({ 
            success: true, 
            message: { 
              id: message.id,
              tempId: tempMessageId,
              deliveryStatus: isReceiverOnline ? 'delivered' : 'sent'
            }
          });
        }
      } catch (error) {
        console.error('Message send error:', error);
        const serverError = { message: 'Server error while sending message', details: error.message };
        socket.emit('error', serverError);
        if (typeof callback === 'function') callback({ success: false, error: serverError });
      }
    });

    // Enhanced typing indicator handling
    socket.on('typing:start', (data) => {
      try {
        const { receiverId } = data;
        const userId = socket.user.id;

        // Add to active conversations
        socket.chatFeatures.activeConversations.add(receiverId);
        socket.chatFeatures.isTyping = true;

        // Store typing status
        socket.chatFeatures.typingStatus.set(receiverId, Date.now());

        // Get receiver's socket
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            // Add to receiver's active conversations
            receiverSocket.chatFeatures.activeConversations.add(userId);

            // Emit typing status
            receiverSocket.emit('typing:start', {
              userId,
              username: socket.user.username,
              timestamp: new Date().toISOString()
            });

            // Set auto-stop typing timeout
            if (socket.typingTimeout) {
              clearTimeout(socket.typingTimeout);
            }

            socket.typingTimeout = setTimeout(() => {
              socket.emit('typing:stop', { receiverId });
              socket.chatFeatures.isTyping = false;
              socket.chatFeatures.typingStatus.delete(receiverId);
            }, 5000);
          }
        }
      } catch (error) {
        console.error('Error in typing indicator:', error);
      }
    });

    // Handle message read status
    socket.on('message:read', async (data) => {
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
          .eq('receiver_id', userId)
          .select()
          .single();

        if (error) {
          console.error('Error marking message as read:', error);
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
      } catch (error) {
        console.error('Error in message:read:', error);
      }
    });

    // Handle conversation initialization
    socket.on('conversation:init', async (data) => {
      try {
        const { userId } = data;
        if (!userId) return;

        // Add to active conversations
        socket.chatFeatures.activeConversations.add(userId);

        // Get receiver's socket
        const receiverSocketId = connectedUsers.get(userId);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            // Add to receiver's active conversations
            receiverSocket.chatFeatures.activeConversations.add(socket.user.id);

            // Notify receiver
            receiverSocket.emit('conversation:init', {
              userId: socket.user.id,
              username: socket.user.username,
              profilePictureUrl: socket.user.profile_picture_url
            });
          }
        }

        // Acknowledge initialization
        socket.emit('conversation:ready', { userId });
      } catch (error) {
        console.error('Error initializing conversation:', error);
        socket.emit('error', {
          source: 'conversation',
          message: 'Failed to initialize conversation'
        });
      }
    });

    // Handle reconnection
    socket.on('client:reconnect', () => {
      // Re-establish connection information
      connectedUsers.set(socket.user.id, socket.id);
      updateUserOnlineStatus(socket.user.id, true);

      // Re-initialize active conversations
      if (socket.chatFeatures.activeConversations.size > 0) {
        socket.chatFeatures.activeConversations.forEach(userId => {
          socket.emit('conversation:init', { userId });
        });
      }

      // Resend any pending messages
      if (socket.chatFeatures.messageQueue.size > 0) {
        socket.chatFeatures.messageQueue.forEach((msgData, tempId) => {
          socket.emit('message:resend', {
            tempId,
            receiverId: msgData.receiverId,
            content: msgData.content,
            mediaUrl: msgData.mediaUrl,
            sequence: msgData.sequence
          });
        });
      }

      // Reset connection metrics
      if (socket.connectionStability) {
        socket.connectionStability.lastMessageTime = Date.now();
        socket.connectionStability.messagesSinceReconnect = 0;
        socket.connectionStability.lastPingResponse = Date.now();
        socket.connectionStability.connectionHealth = 100;
        socket.connectionStability.missedPings = 0;
      }
    });
  });
};

/**
 * Update user's online status in database
 * @param {string} userId - User ID
 * @param {boolean} online - Online status
 */
const updateUserOnlineStatus = async (userId, online) => {
  try {
    await supabase
      .from('users')
      .update({
        is_online: online,
        last_active: new Date()
      })
      .eq('id', userId);
  } catch (error) {
    console.error('Error updating online status:', error);
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
  // Sanitize user data to include only necessary fields
  const sanitizedUser = {
    id: otherUser.id,
    username: otherUser.username || 'Anonymous',
    name: otherUser.name || otherUser.first_name || otherUser.username || 'User',
    profilePicture: otherUser.profilePicture || otherUser.profile_picture_url || null,
    bio: otherUser.bio || null,
    interests: otherUser.interests || []
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
const findMatchForUser = (socket) => {
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
      console.log(`No suitable matches found for user ${userId}`);
      socket.emit('match:notFound', { message: 'No suitable matches found at this time' });
      
      // Reset processing flag but keep in matchmaking pool
      userPoolData.isBeingProcessed = false;
      matchmakingPool.set(userId, userPoolData);
      
      // Set a timeout to try again after delay
      const timeoutId = setTimeout(() => {
        if (connectedUsers.has(userId) && matchmakingPool.has(userId)) {
          console.log(`Retrying match for user ${userId}`);
          socket.emit('match:waiting', { message: 'Searching for a match...' });
          findMatchForUser(socket);
        }
      }, 10000); // Try again in 10 seconds
      
      userTimeouts.set(userId, timeoutId);
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
  notifyConversationDeleted
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