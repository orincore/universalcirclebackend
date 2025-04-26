const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');

// Track connected users and their socket IDs
const connectedUsers = new Map();

// Reference to Socket.IO instance
let ioInstance;

// Track active matches with acceptance status
// Format: { matchId: { users: [userId1, userId2], acceptances: { userId1: boolean, userId2: boolean } } }
const activeMatches = new Map();

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
    socket.on('findRandomMatch', async (criteria = {}) => {
      try {
        const userId = socket.user.id;
        console.log(`User ${userId} is looking for a random match with criteria:`, criteria);
        
        // Validate that user has defined interests
        if (!socket.user.interests || !Array.isArray(socket.user.interests) || socket.user.interests.length === 0) {
          socket.emit('error', {
            source: 'findRandomMatch',
            message: 'You must have at least one interest defined in your profile'
          });
          return;
        }
        
        // Find online users with matching interests
        const onlineUsers = [];
        for (const [onlineUserId, socketId] of connectedUsers.entries()) {
          // Skip self
          if (onlineUserId === userId) continue;
          
          // Skip users already in a match
          let alreadyInMatch = false;
          for (const [, matchData] of activeMatches.entries()) {
            if (matchData.users.includes(onlineUserId)) {
              alreadyInMatch = true;
              break;
            }
          }
          if (alreadyInMatch) continue;
          
          // Get user data
          const { data: onlineUser } = await supabase
            .from('users')
            .select('*')
            .eq('id', onlineUserId)
            .single();
            
          if (!onlineUser) continue;
          
          // Check if the user has defined interests
          if (!onlineUser.interests || !Array.isArray(onlineUser.interests) || onlineUser.interests.length === 0) {
            continue;
          }
          
          // Check for at least one matching interest
          const matchingInterests = socket.user.interests.filter(interest => 
            onlineUser.interests.includes(interest)
          );
          
          if (matchingInterests.length > 0) {
            onlineUsers.push({
              user: onlineUser,
              socketId,
              matchingInterests
            });
          }
        }
        
        if (onlineUsers.length > 0) {
          // Select the first matching user for simplicity
          const match = onlineUsers[0];
          const matchId = `match_${Date.now()}_${userId}_${match.user.id}`;
          
          // Create a match entry
          activeMatches.set(matchId, {
            users: [userId, match.user.id],
            acceptances: { [userId]: false, [match.user.id]: false },
            createdAt: new Date()
          });
          
          // Sanitize user data
          const sanitizeUser = (user) => ({
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
            profilePictureUrl: user.profile_picture_url,
            interests: user.interests,
            preference: user.preference,
            bio: user.bio || ''
          });
          
          // Emit match found to both users
          console.log(`Match found between ${userId} and ${match.user.id} with ID ${matchId}`);
          
          // Notify current user
          socket.emit('match:found', {
            matchId,
            match: {
              id: matchId,
              user: sanitizeUser(match.user),
              matchingInterests,
              createdAt: new Date(),
              isPending: true
            }
          });
          
          // Notify matched user
          const matchingInterestsForOther = match.user.interests.filter(interest => 
            socket.user.interests.includes(interest)
          );
          
          io.to(match.socketId).emit('match:found', {
            matchId,
            match: {
              id: matchId,
              user: sanitizeUser(socket.user),
              matchingInterests: matchingInterestsForOther,
              createdAt: new Date(),
              isPending: true
            }
          });
        } else {
          // No matches found
          socket.emit('match:waiting', {
            message: 'Looking for users with similar interests...'
          });
          
          // Set a timeout to try again in a few seconds
          setTimeout(() => {
            // Check if user is still connected
            if (connectedUsers.has(userId)) {
              socket.emit('findRandomMatch', criteria);
            }
          }, 5000); // Try again after 5 seconds
        }
      } catch (error) {
        console.error('Error finding random match:', error);
        socket.emit('error', {
          source: 'findRandomMatch',
          message: 'Error finding a match'
        });
      }
    });
    
    // Handle cancel matching request
    socket.on('cancelRandomMatch', () => {
      const userId = socket.user.id;
      console.log(`User ${userId} cancelled matchmaking`);
      
      // No need to remove from a queue since we're not using a queue anymore
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
      console.log(`User disconnected: ${socket.user.id} (${socket.user.username})`);
      
      // Remove user from connected users map
      connectedUsers.delete(socket.user.id);
      
      // Update user's online status in database
      updateUserOnlineStatus(socket.user.id, false);
      
      // Emit offline status to other users
      io.emit('user:status', {
        userId: socket.user.id,
        online: false
      });
      
      // Handle any active matches
      for (const [matchId, matchData] of activeMatches.entries()) {
        if (matchData.users.includes(socket.user.id)) {
          // Notify the other user about disconnection
          const otherUserId = matchData.users.find(id => id !== socket.user.id);
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
 * @param {object} match - Match object from database
 * @param {object} user1 - User 1 details
 * @param {object} user2 - User 2 details
 */
const notifyMatchFound = async (match, user1, user2) => {
  if (!ioInstance) {
    console.error('Socket.IO instance not available');
    return;
  }

  try {
    console.log('Match found:', {
      matchId: match.id,
      user1Id: user1.id,
      user1Name: `${user1.first_name} ${user1.last_name}`,
      user2Id: user2.id,
      user2Name: `${user2.first_name} ${user2.last_name}`,
      compatibilityScore: match.compatibility_score
    });

    // Sanitize user objects to remove sensitive information but include more details for display
    const sanitizeUser = (user) => ({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      profilePictureUrl: user.profile_picture_url,
      interests: user.interests,
      preference: user.preference,
      bio: user.bio || '',  // Include bio if available
      isOnline: user.is_online || false,
      lastActive: user.last_active || new Date()
    });

    const user1Sanitized = sanitizeUser(user1);
    const user2Sanitized = sanitizeUser(user2);

    // Get socket IDs for both matched users
    const user1SocketId = connectedUsers.get(match.user1_id);
    const user2SocketId = connectedUsers.get(match.user2_id);
    
    console.log('Socket IDs:', {
      user1SocketId: user1SocketId || 'not connected',
      user2SocketId: user2SocketId || 'not connected'
    });
    
    // Find matching interests
    const matchingInterests = user1.interests.filter(interest => 
      user2.interests.includes(interest)
    );
    
    // Send match notification to user1
    if (user1SocketId) {
      console.log(`Emitting match:found to user1 (${user1.id})`);
      ioInstance.to(user1SocketId).emit('match:found', {
        matchId: match.id,
        match: {
          id: match.id,
          user: user2Sanitized,
          matchingInterests,
          createdAt: match.created_at,
          isPending: true
        }
      });
    } else {
      console.log(`User1 (${user1.id}) is not connected, cannot send real-time notification`);
    }
    
    // Send match notification to user2
    if (user2SocketId) {
      console.log(`Emitting match:found to user2 (${user2.id})`);
      ioInstance.to(user2SocketId).emit('match:found', {
        matchId: match.id,
        match: {
          id: match.id,
          user: user1Sanitized,
          matchingInterests,
          createdAt: match.created_at,
          isPending: true
        }
      });
    } else {
      console.log(`User2 (${user2.id}) is not connected, cannot send real-time notification`);
    }
  } catch (error) {
    console.error('Error notifying match found:', error);
  }
};

module.exports = {
  initializeSocket,
  notifyMatchFound,
  connectedUsers
}; 
