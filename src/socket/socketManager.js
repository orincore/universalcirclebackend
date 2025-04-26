const { verifyToken } = require('../utils/jwt');
const supabase = require('../config/database');

// Track connected users and their socket IDs
const connectedUsers = new Map();

/**
 * Initialize Socket.IO with authentication
 * @param {object} io - Socket.IO server instance
 */
const initializeSocket = (io) => {
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
    socket.on('match:accepted', async (data) => {
      try {
        const { matchId } = data;
        
        // Get match data
        const { data: match, error } = await supabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .single();
        
        if (error || !match) {
          console.error('Error fetching match:', error);
          return;
        }
        
        // Determine the other user
        const otherUserId = match.user1_id === socket.user.id ? match.user2_id : match.user1_id;
        
        // Notify the other user if online
        const otherUserSocketId = connectedUsers.get(otherUserId);
        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit('match:accepted', {
            matchId,
            userId: socket.user.id
          });
        }
      } catch (error) {
        console.error('Match accepted error:', error);
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

module.exports = {
  initializeSocket
}; 