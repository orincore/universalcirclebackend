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
        
        // Add user to matchmaking pool
        matchmakingPool.set(userId, {
          userId,
          socketId: socket.id,
          user: socket.user,
          criteria,
          interests: socket.user.interests,
          joinedAt: new Date()
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
        
        // Add user to matchmaking pool
        matchmakingPool.set(userId, {
          userId,
          socketId: socket.id,
          user: socket.user,
          criteria,
          interests: socket.user.interests,
          joinedAt: new Date()
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
          console.log(`Match ${matchId} accepted by both users`);
          
          // Get both user ids
          const [user1Id, user2Id] = matchData.users;
          
          // Create the match in the database
          createMatchInDatabase(matchId, user1Id, user2Id);
          
          // Create a chat room for the match
          const roomId = `match_${matchId}`;
          
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
          console.log(`Match ${matchId} accepted by both users`);
          
          // Get both user ids
          const [user1Id, user2Id] = matchData.users;
          
          // Create the match in the database
          createMatchInDatabase(matchId, user1Id, user2Id);
          
          // Create a chat room for the match
          const roomId = `match_${matchId}`;
          
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
        
        // Put both users back in the matchmaking pool
        if (connectedUsers.has(userId)) {
          const userSocket = io.sockets.sockets.get(socket.id);
          if (userSocket) {
            // Add back to pool after a short delay
            setTimeout(() => {
              if (connectedUsers.has(userId)) {
                matchmakingPool.set(userId, {
                  userId,
                  socketId: socket.id,
                  user: socket.user,
                  interests: socket.user.interests,
                  joinedAt: new Date()
                });
                socket.emit('match:waiting', { message: 'Searching for a new match...' });
                findMatchForUser(userSocket);
              }
            }, 1000);
          }
        }
        
        if (otherUserSocketId && connectedUsers.has(otherUserId)) {
          const otherSocket = io.sockets.sockets.get(otherUserSocketId);
          if (otherSocket) {
            // Add back to pool after a short delay
            setTimeout(() => {
              if (connectedUsers.has(otherUserId)) {
                matchmakingPool.set(otherUserId, {
                  userId: otherUserId,
                  socketId: otherUserSocketId,
                  user: otherSocket.user,
                  interests: otherSocket.user.interests,
                  joinedAt: new Date()
                });
                io.to(otherUserSocketId).emit('match:waiting', { message: 'Searching for a new match...' });
                findMatchForUser(otherSocket);
              }
            }, 1000);
          }
        }
        
        // Clear any pending timeouts
        clearMatchmakingTimeouts(userId);
        clearMatchmakingTimeouts(otherUserId);
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
          chat_room_id: `match_${matchId}`,
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
          chat_room_id: `match_${matchId}`,
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
  // Create a unique match ID
  const matchId = `match_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
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
  
  // Emit match found event to both users
  const socket1 = connectedUsers.get(user1.id);
  const socket2 = connectedUsers.get(user2.id);
  
  if (socket1) {
    ioInstance.to(socket1).emit('match:found', { match: user1MatchData });
    console.log(`Notified user ${user1.id} about match with ${user2.id} using match:found event`);
  }
  
  if (socket2) {
    ioInstance.to(socket2).emit('match:found', { match: user2MatchData });
    console.log(`Notified user ${user2.id} about match with ${user1.id} using match:found event`);
  }
  
  return matchId;
};

// Function to create match data in format expected by Flutter client
const createMatchData = (otherUser, sharedInterests, matchId) => {
  // Sanitize user data to include only necessary fields
  const sanitizedUser = {
    id: otherUser.id,
    username: otherUser.username || 'Anonymous',
    name: otherUser.name || otherUser.username || 'User',
    profilePicture: otherUser.profilePicture || null,
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
    const userInterests = socket.user.interests || [];
    
    if (userInterests.length === 0) {
      console.log(`User ${userId} has no interests. Cannot find match.`);
      socket.emit('error', { 
        source: 'findRandomMatch',
        message: 'You need to add interests to your profile before matchmaking' 
      });
      return;
    }
    
    console.log(`Finding match for user ${userId} with interests: ${userInterests.join(', ')}`);
    
    // Array of potential matches with compatibility scores
    const potentialMatches = [];
    
    // Check all users in the matchmaking pool
    for (const [otherUserId, otherUser] of matchmakingPool.entries()) {
      // Skip self
      if (otherUserId === userId) continue;
      
      const otherUserInterests = otherUser.interests || [];
      
      // Find shared interests
      const sharedInterests = userInterests.filter(interest => 
        otherUserInterests.includes(interest)
      );
      
      // Only consider matches with at least one shared interest
      if (sharedInterests.length > 0) {
        potentialMatches.push({
          userId: otherUserId,
          socketId: otherUser.socketId,
          user: otherUser.user,
          sharedInterests,
          score: sharedInterests.length // Score based on number of shared interests
        });
      }
    }
    
    // Sort by score (highest first)
    potentialMatches.sort((a, b) => b.score - a.score);
    
    if (potentialMatches.length > 0) {
      // Get the best match
      const bestMatch = potentialMatches[0];
      console.log(`Found best match for user ${userId}: ${bestMatch.userId} with ${bestMatch.score} shared interests`);
      
      // Generate a match ID
      const matchId = uuidv4();
      
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
      
      // Remove both users from matchmaking pool
      matchmakingPool.delete(userId);
      matchmakingPool.delete(bestMatch.userId);
      
      // Get sockets for both users
      const user1Socket = socket;
      const user2Socket = ioInstance.sockets.sockets.get(bestMatch.socketId);
      
      // Notify both users
      notifyMatchFound(user1Socket.user, user2Socket.user, bestMatch.sharedInterests);
      
      // Set timeout for match acceptance
      const timeoutId = setTimeout(() => {
        // Check if match still exists and hasn't been fully accepted
        if (activeMatches.has(matchId)) {
          const matchData = activeMatches.get(matchId);
          const bothAccepted = Object.values(matchData.acceptances).every(status => status === true);
          
          if (!bothAccepted) {
            console.log(`Match ${matchId} timed out`);
            
            // Notify both users
            matchData.users.forEach(userId => {
              const socketId = connectedUsers.get(userId);
              if (socketId) {
                ioInstance.to(socketId).emit('match:timeout', {
                  matchId,
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
                    joinedAt: new Date()
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
            activeMatches.delete(matchId);
          }
        }
      }, MATCH_ACCEPTANCE_TIMEOUT);
      
      // Store timeout IDs for both users
      userTimeouts.set(userId, timeoutId);
      userTimeouts.set(bestMatch.userId, timeoutId);
    } else {
      console.log(`No suitable matches found for user ${userId}`);
      socket.emit('match:notFound', { message: 'No suitable matches found at this time' });
      
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
  MATCH_ACCEPTANCE_TIMEOUT
}; 