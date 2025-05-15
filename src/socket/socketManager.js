const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');
const { v4: uuidv4 } = require('uuid');

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
  console.log(`Running matchmaking pool cleanup. Current pool size: ${matchmakingPool.size}`);
  
  // Track how many users were removed
  let removedCount = 0;
  
  // Check each user in the pool
  for (const [userId, userData] of matchmakingPool.entries()) {
    let shouldRemove = false;
    
    // Check if user is connected
    if (!connectedUsers.has(userId)) {
      console.log(`Cleanup: User ${userId} is not in connected users map. Removing from pool.`);
      shouldRemove = true;
    } else {
      // Check if socket is valid
      const socketId = connectedUsers.get(userId);
      const socket = ioInstance.sockets.sockets.get(socketId);
      if (!socket) {
        console.log(`Cleanup: User ${userId} has invalid socket ID ${socketId}. Removing from pool.`);
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
  
  console.log(`Matchmaking pool cleanup completed. Removed ${removedCount} users. New pool size: ${matchmakingPool.size}`);
};

/**
 * Find matches for all users in the matchmaking pool
 */
const findMatchesForAllUsers = () => {
  // Clean up the pool first to ensure all users are valid
  cleanMatchmakingPool();
  
  if (matchmakingPool.size < 2) {
    console.log(`Not enough users in matchmaking pool (${matchmakingPool.size}). Need at least 2 users.`);
    return;
  }
  
  console.log(`Running global matchmaking for ${matchmakingPool.size} users in pool`);
  
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
      console.log(`User ${userId} has no socket ID in connected users map, removing from pool`);
      matchmakingPool.delete(userId);
      continue;
    }
    
    const socket = ioInstance.sockets.sockets.get(socketId);
    if (!socket) {
      console.log(`User ${userId} socket not found, removing from pool`);
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
    console.log('Global matchmaking already running');
    return;
  }
  
  console.log('Starting global matchmaking system');
  matchmakingIntervalId = setInterval(findMatchesForAllUsers, MATCHMAKING_INTERVAL);
  
  // Also start the pool cleanup interval
  if (poolCleanupIntervalId === null) {
    console.log('Starting matchmaking pool cleanup system');
    poolCleanupIntervalId = setInterval(cleanMatchmakingPool, POOL_CLEANUP_INTERVAL);
  }
};

/**
 * Stop the global matchmaking system
 */
const stopGlobalMatchmaking = () => {
  if (matchmakingIntervalId === null) {
    console.log('Global matchmaking not running');
    return;
  }
  
  console.log('Stopping global matchmaking system');
  clearInterval(matchmakingIntervalId);
  matchmakingIntervalId = null;
  
  // Also stop the pool cleanup interval
  if (poolCleanupIntervalId !== null) {
    console.log('Stopping matchmaking pool cleanup system');
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
    console.log(`Cleared timeout for user ${userId}`);
  }
};

/**
 * Initialize Socket.IO with authentication
 * @param {object} io - Socket.IO server instance
 */
const initializeSocket = (io) => {
  // Store reference to io instance
  ioInstance = io;
  
  // Start the global matchmaking system
  startGlobalMatchmaking();
  
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
    
    // Emit online status to other users
    io.emit('user:status', {
      userId: socket.user.id,
      online: true
    });
    
    // Handle private messages
    socket.on('message:send', async (data) => {
      try {
        const { receiverId, content, mediaUrl } = data;
        const senderId = socket.user.id;
        
        // Validate required fields
        if (!receiverId || !content) {
          socket.emit('error', {
            message: 'Receiver ID and content are required'
          });
          return;
        }
        
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
            updated_at: new Date()
          })
          .select()
          .single();
        
        if (error) {
          console.error('Error creating message:', error);
          socket.emit('error', {
            message: 'Failed to send message'
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
        
        // Emit message to sender
        socket.emit('message:sent', message);
        
        // Emit message to receiver if online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:received', message);
        }
      } catch (error) {
        console.error('Message send error:', error);
        socket.emit('error', {
          message: 'Server error while sending message'
        });
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
        console.log(`User interests: ${JSON.stringify(socket.user.interests)}`);
        
        // Validate that user has interests
        if (!socket.user.interests || socket.user.interests.length === 0) {
          console.log(`User ${userId} has no interests. Aborting match.`);
          socket.emit('error', { 
            source: 'matchmaking',
            message: 'You need to add interests to your profile before matchmaking' 
          });
          return;
        }
        
        // Verify socket is connected
        const socketId = connectedUsers.get(userId);
        if (!socketId || socketId !== socket.id) {
          console.log(`User ${userId} has inconsistent socket information. Updating socket ID.`);
          connectedUsers.set(userId, socket.id);
        }
        
        // Add user to matchmaking pool
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
        socket.emit('match:waiting', { message: 'Searching for a match...' });
        
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
        
        // Verify socket is connected
        const socketId = connectedUsers.get(userId);
        if (!socketId || socketId !== socket.id) {
          console.log(`User ${userId} has inconsistent socket information. Updating socket ID.`);
          connectedUsers.set(userId, socket.id);
        }
        
        // Add user to matchmaking pool
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
          message: 'Looking for users with similar interests...'
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
    
    // Handle messages in match rooms
    socket.on('match:message', (data) => {
      try {
        const { matchId, message } = data;
        const userId = socket.user.id;
        
        console.log(`User ${userId} sending message in match room ${matchId}: ${message}`);
        
        // Emit the message to the match room
        socket.to(matchId).emit('match:message', {
          senderId: userId,
          senderName: socket.user.username || 'User',
          message,
          timestamp: new Date().toISOString()
        });
        
        // Send confirmation to sender
        socket.emit('match:messageSent', {
          matchId,
          message,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error sending match message:', error);
        socket.emit('error', {
          source: 'match:message',
          message: 'Failed to send message'
        });
      }
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
    
    // If a match already exists, update it instead of creating a new one
    if (existingMatch && existingMatch.length > 0) {
      console.log(`Match already exists between users ${user1Id} and ${user2Id}, updating existing match`);
      
      // Get the match data from active matches if it exists
      let matchData = null;
      if (activeMatches.has(matchId)) {
        matchData = activeMatches.get(matchId);
      }
      
      const currentTime = new Date();
      
      const { data, error } = await supabase
        .from('matches')
        .update({
          status: 'accepted',
          compatibility_score: 100, // Default score for accepted matches
          shared_interests: matchData?.sharedInterests || [],
          chat_room_id: matchId,
          updated_at: currentTime,
          accepted_at: currentTime
        })
        .eq('id', existingMatch[0].id);
        
      if (error) {
        console.error('Error updating existing match in database:', error);
        return { success: false, error };
      }
      
      console.log(`Successfully updated existing match in database: ${existingMatch[0].id}`);
      
      // Use the existing match ID for updates
      matchId = existingMatch[0].id;
    } else {
      // Get the match data from active matches if it exists
      let matchData = null;
      if (activeMatches.has(matchId)) {
        matchData = activeMatches.get(matchId);
      }
      
      const currentTime = new Date();
      
      const { data, error } = await supabase
      .from('matches')
      .insert({
        id: matchId,
        user1_id: user1Id,
        user2_id: user2Id,
        status: 'accepted',
          compatibility_score: 100, // Default score for accepted matches
          shared_interests: matchData?.sharedInterests || [],
          chat_room_id: matchId,
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
    
    // Update user records to indicate they're in a match
    const updateUser1 = await supabase
      .from('users')
      .update({
        current_match_id: matchId,
        updated_at: new Date()
      })
      .eq('id', user1Id);
      
    const updateUser2 = await supabase
      .from('users')
      .update({
        current_match_id: matchId,
        updated_at: new Date()
      })
      .eq('id', user2Id);
      
    if (updateUser1.error) {
      console.error(`Error updating user ${user1Id} with match:`, updateUser1.error);
    }
    
    if (updateUser2.error) {
      console.error(`Error updating user ${user2Id} with match:`, updateUser2.error);
    }
    
    return { success: true };
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
  // Create a unique match ID using UUID
  const matchId = uuidv4();
  console.log(`Generated UUID match ID: ${matchId}`);
  
  // Add to active matches with appropriate data
  activeMatches.set(matchId, {
    id: matchId,
    users: [user1.id, user2.id],
    sharedInterests,
    timestamp: new Date(),
    acceptances: {
      [user1.id]: false,
      [user2.id]: false
    }
  });
  
  console.log(`Match created: ${matchId} between ${user1.id} and ${user2.id} with ${sharedInterests.length} shared interests`);
  console.log(`Match data: ${JSON.stringify(activeMatches.get(matchId))}`);
  
  // Create properly formatted match data for Flutter client
  const user1MatchData = createMatchData(user2, sharedInterests, matchId);
  const user2MatchData = createMatchData(user1, sharedInterests, matchId);
  
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
      console.log(`Notified user ${user1.id} about match with ${user2.id} using match:found event`);
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
const createMatchData = (otherUser, sharedInterests, matchId) => {
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
    isPending: true
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
    
    console.log(`Finding match for user ${userId} with interests: ${userInterests.join(', ')}`);
    
    // Debug: Log all users in matchmaking pool
    console.log(`Current matchmaking pool size: ${matchmakingPool.size}`);
    for (const [poolUserId, poolUser] of matchmakingPool.entries()) {
      if (poolUserId !== userId) {
        console.log(`Pool user ${poolUserId} with interests: ${poolUser.interests ? poolUser.interests.join(', ') : 'none'}`);
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
        console.log(`Found ${sharedInterests.length} shared interests between users ${userId} and ${otherUserId}: ${sharedInterests.join(', ')}`);
        
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
          score: combinedScore // Better scoring based on relative interest match
        });
      }
    }
    
    // Sort by score (highest first)
    potentialMatches.sort((a, b) => b.score - a.score);
    
    if (potentialMatches.length > 0) {
      // Get the best match
      const bestMatch = potentialMatches[0];
      console.log(`Found best match for user ${userId}: ${bestMatch.userId} with score ${bestMatch.score.toFixed(2)} and ${bestMatch.sharedInterests.length} shared interests`);
      
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

module.exports = {
  initializeSocket,
  notifyMatchFound,
  connectedUsers,
  userTimeouts,
  clearMatchmakingTimeouts,
  matchmakingPool,
  activeMatches,
  findMatchForUser,
  createMatchInDatabase,
  MATCH_ACCEPTANCE_TIMEOUT,
  startGlobalMatchmaking,
  stopGlobalMatchmaking,
  findMatchesForAllUsers
}; 