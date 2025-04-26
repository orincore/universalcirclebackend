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
    socket.on('findRandomMatch', async (criteria) => {
      try {
        // Clear any existing matchmaking timeouts for this user
        const userId = socket.user.id;
        clearMatchmakingTimeouts(userId);
        
        console.log(`Finding random match for user: ${userId}`);
        console.log('Match criteria:', JSON.stringify(criteria));
        console.log(`User interests: ${JSON.stringify(socket.user.interests)}`);
        
        // Validate that user has interests
        if (!socket.user.interests || socket.user.interests.length === 0) {
          console.log(`User ${userId} has no interests. Aborting match.`);
          socket.emit('match:error', { message: 'You need to add interests to your profile before matchmaking' });
          return;
        }

        // Get interests from criteria and filter out empty or undefined values
        const userInterests = [...(criteria.interests || []), ...(socket.user.interests || [])].filter(Boolean);
        
        if (userInterests.length === 0) {
          console.log(`User ${userId} has no interests after filtering. Aborting match.`);
          socket.emit('match:error', { message: 'You need to add interests to your profile before matchmaking' });
          return;
        }

        // Log user connection status
        console.log(`User connection status: ${connectedUsers.has(userId) ? 'connected' : 'not connected'}`);
        console.log(`Total connected users: ${connectedUsers.size}`);
        
        // Array of matching users
        const matchCandidates = [];

        // Get all online users except the current user
        connectedUsers.forEach((socketId, otherUserId) => {
          // Skip if it's the same user
          if (otherUserId === userId) {
            console.log(`Skipping current user: ${otherUserId}`);
            return;
          }

          console.log(`Checking match with user: ${otherUserId}`);
          
          // Get the socket for the other user
          const otherUserSocket = io.sockets.sockets.get(socketId);
          
          if (!otherUserSocket) {
            console.log(`Socket not found for user: ${otherUserId}`);
            return;
          }
          
          // Skip if user is already in a match
          if (otherUserSocket.inMatch) {
            console.log(`User ${otherUserId} is already in a match. Skipping.`);
            return;
          }
          
          // Skip if user has no interests
          if (!otherUserSocket.user.interests || otherUserSocket.user.interests.length === 0) {
            console.log(`User ${otherUserId} has no interests. Skipping.`);
            return;
          }
          
          // Find matching interests
          const otherUserInterests = [...(otherUserSocket.user.interests || [])].filter(Boolean);
          
          if (otherUserInterests.length === 0) {
            console.log(`User ${otherUserId} has no interests after filtering. Skipping.`);
            return;
          }
          
          // Find the matching interests between the two users
          const matchingInterests = userInterests.filter(interest => 
            otherUserInterests.includes(interest)
          );
          
          // Log match details for debugging
          console.log(`Matching interests with ${otherUserId}: ${JSON.stringify(matchingInterests)}`);
          console.log(`Number of matching interests: ${matchingInterests.length}`);
          
          if (matchingInterests.length > 0) {
            matchCandidates.push({
              userId: otherUserId,
              socketId: socketId,
              matchingInterests: matchingInterests,
              interestCount: matchingInterests.length
            });
          }
        });
        
        console.log(`Found ${matchCandidates.length} potential matches for user ${userId}`);
        
        // Sort candidates by number of matching interests (highest first)
        matchCandidates.sort((a, b) => b.interestCount - a.interestCount);
        
        if (matchCandidates.length > 0) {
          // Select the best match (most matching interests)
          const bestMatch = matchCandidates[0];
          console.log(`Selected best match: ${bestMatch.userId} with ${bestMatch.interestCount} matching interests`);
          
          // Generate a unique match ID
          const matchId = uuidv4();
          
          // Set both users as in a match
          socket.inMatch = { matchId, otherUserId: bestMatch.userId };
          
          const otherUserSocket = io.sockets.sockets.get(bestMatch.socketId);
          otherUserSocket.inMatch = { matchId, otherUserId: userId };
          
          console.log(`Created match ${matchId} between ${userId} and ${bestMatch.userId}`);
          
          // Notify both users
          try {
            const result = notifyMatchFound(socket, otherUserSocket, matchId, bestMatch.matchingInterests);
            console.log(`Match notification result: ${JSON.stringify(result)}`);
          } catch (error) {
            console.error(`Error notifying match: ${error.message}`);
            // Don't abort - continue execution
          }
        } else {
          console.log(`No matches found for user ${userId}. Will retry after timeout.`);
          socket.emit('match:searching', { message: 'Searching for a match...' });
          
          // Set a timeout to retry matchmaking after a delay
          const timeoutId = setTimeout(() => {
            if (connectedUsers.has(userId)) {
              console.log(`Auto-restarting matchmaking for ${userId} after timeout`);
              socket.emit('match:not-found', { message: 'No match found. Trying again...' });
              
              // Wait a bit before restarting
              setTimeout(() => {
                socket.emit('findRandomMatch', criteria);
              }, 1000);
            }
          }, 10000);
          
          // Store the timeout for cleanup
          userTimeouts.set(userId, timeoutId);
        }
      } catch (error) {
        console.error('Error finding random match:', error);
        
        // Log detailed error for debugging
        if (error.stack) {
          console.error('Stack trace:', error.stack);
        }
        
        // Inform the user
        socket.emit('error', {
          source: 'findRandomMatch',
          message: 'Error finding a match, please try again'
        });
        
        // Try one more time with reduced criteria after a delay
        const userId = socket.user.id;
        console.log(`Will retry matchmaking for ${userId} with reduced criteria due to error`);
        
        const timeoutId = setTimeout(() => {
          if (connectedUsers.has(userId)) {
            console.log(`Auto-retrying matchmaking for ${userId} after error`);
            
            // Simplify criteria to just the first interest if there are multiple
            let retryCriteria = { ...criteria };
            if (socket.user.interests && socket.user.interests.length > 1) {
              retryCriteria.interests = [socket.user.interests[0]];
            }
            
            socket.emit('findRandomMatch', retryCriteria);
          }
        }, 3000);
        
        // Store the timeout for cleanup
        userTimeouts.set(userId, timeoutId);
      }
    });
    
    // Handle cancel matching request
    socket.on('cancelRandomMatch', () => {
      const userId = socket.user.id;
      console.log(`User ${userId} cancelled matchmaking`);
      
      // Clear any matchmaking timeouts
      clearMatchmakingTimeouts(userId);
      
      socket.emit('match:cancelled', {
        message: 'Matchmaking cancelled'
      });
    });
    
    // Handle match acceptance or rejection
    socket.on('match:accepted', ({ matchId, accepted }) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} ${accepted ? 'accepted' : 'rejected'} match ${matchId}`);
        
        if (!activeMatches.has(matchId)) {
          socket.emit('error', {
            source: 'match:accepted',
            message: 'Match not found'
          });
          return;
        }
        
        const matchData = activeMatches.get(matchId);
        
        // Get the other user ID
        const otherUserId = matchData.users.find(id => id !== userId);
        const otherUserSocketId = connectedUsers.get(otherUserId);
        
        if (accepted) {
          // Update acceptance status
          matchData.acceptances[userId] = true;
          activeMatches.set(matchId, matchData);
          
          // Notify the other user about this user's acceptance
          if (otherUserSocketId) {
            io.to(otherUserSocketId).emit('match:user_accepted', {
              matchId,
              userId,
              message: 'The other user has accepted the match'
            });
          }
          
          // Check if both users accepted
          const bothAccepted = Object.values(matchData.acceptances).every(status => status === true);
          
          if (bothAccepted) {
            console.log(`Match ${matchId} accepted by both users`);
            
            // Get both user ids
            const [user1Id, user2Id] = matchData.users;
            
            // Create the match in the database
            createMatchInDatabase(matchId, user1Id, user2Id);
            
            // Emit match connected to both users
            matchData.users.forEach(userId => {
              const socketId = connectedUsers.get(userId);
              if (socketId) {
                const otherUserId = userId === user1Id ? user2Id : user1Id;
                io.to(socketId).emit('match:connected', {
                  matchId,
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
        } else {
          // User rejected the match
          
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
          
          // Auto-restart matchmaking for both users
          // For the current user
          setTimeout(() => {
            if (connectedUsers.has(userId)) {
              socket.emit('match:restart');
            }
          }, 1000);
          
          // For the other user
          setTimeout(() => {
            if (otherUserSocketId && connectedUsers.has(otherUserId)) {
              io.to(otherUserSocketId).emit('match:restart');
            }
          }, 1000);
        }
      } catch (error) {
        console.error('Error handling match acceptance/rejection:', error);
        socket.emit('error', {
          source: 'match:accepted',
          message: 'Error processing your response'
        });
      }
    });
    
    // Handle matchmaking restart
    socket.on('match:restart', (criteria = {}) => {
      try {
        const userId = socket.user.id;
        
        // Clear any existing timeouts
        clearMatchmakingTimeouts(userId);
        
        console.log(`User ${userId} is restarting matchmaking with criteria:`, criteria);
        
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
    
    // Disconnect handler
    socket.on('disconnect', () => {
      const userId = socket.user.id;
      console.log(`User disconnected: ${userId} (${socket.user.username})`);
      
      // Clear any matchmaking timeouts
      clearMatchmakingTimeouts(userId);
      
      // Remove user from connected users map
      connectedUsers.delete(userId);
      
      // Update user's online status in database
      updateUserOnlineStatus(userId, false);
      
      // Emit offline status to other users
      io.emit('user:status', {
        userId: userId,
        online: false
      });
      
      // Handle any active matches
      for (const [matchId, matchData] of activeMatches.entries()) {
        if (matchData.users.includes(userId)) {
          // Notify the other user about disconnection
          const otherUserId = matchData.users.find(id => id !== userId);
          const otherSocketId = connectedUsers.get(otherUserId);
          
          if (otherSocketId) {
            io.to(otherSocketId).emit('match:disconnected', {
              matchId,
              message: 'The other user disconnected'
            });
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
    const { error } = await supabase
      .from('matches')
      .insert({
        id: matchId,
        user1_id: user1Id,
        user2_id: user2Id,
        status: 'accepted',
        compatibility_score: 100, // Simply set to 100 for accepted matches
        created_at: new Date(),
        updated_at: new Date()
      });
      
    if (error) {
      console.error('Error creating match in database:', error);
    }
  } catch (error) {
    console.error('Error creating match in database:', error);
  }
};

/**
 * Notify users when a match is found
 * @param {object} user1Socket - User 1 socket
 * @param {object} user2Socket - User 2 socket
 * @param {string} matchId - Match ID
 * @param {array} matchingInterests - Array of matching interests
 */
const notifyMatchFound = (user1Socket, user2Socket, matchId, matchingInterests) => {
  try {
    // Sanitize user data for sharing
    const sanitizeUser = (user) => ({
      id: user.id,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      username: user.username || '',
      profilePictureUrl: user.profile_picture_url || '',
      interests: user.interests || [],
      bio: user.bio || ''
    });

    // Notify first user
    user1Socket.emit('match:found', {
      matchId,
      match: {
        id: matchId,
        user: sanitizeUser(user2Socket.user),
        matchingInterests,
        createdAt: new Date(),
        isPending: true
      }
    });

    // Notify second user
    user2Socket.emit('match:found', {
      matchId,
      match: {
        id: matchId,
        user: sanitizeUser(user1Socket.user),
        matchingInterests,
        createdAt: new Date(),
        isPending: true
      }
    });

    return { success: true };
  } catch (error) {
    console.error(`Error in notifyMatchFound: ${error.message}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  initializeSocket,
  notifyMatchFound,
  connectedUsers,
  userTimeouts,
  clearMatchmakingTimeouts
}; 
