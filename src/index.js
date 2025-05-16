const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
console.log('Environment variables loaded. SUPABASE_URL exists:', !!process.env.SUPABASE_URL);

// Import database connection (after loading environment variables)
const supabase = require('./config/database');

// Import socket manager
const { initializeSocket, connectedUsers } = require('./socket/socketManager');

// Import middleware
const { authenticate } = require('./middlewares/auth');

// Import logger
const logger = require('./utils/logger');

// Import health monitoring service
const { startHealthMonitoring } = require('./services/healthMonitor');

// Routes
const authRoutes = require('./routes/authRoutes');
const interestRoutes = require('./routes/interestRoutes');
const profileRoutes = require('./routes/profileRoutes');
const userRoutes = require('./routes/userRoutes');
const messageRoutes = require('./routes/messageRoutes');
const matchmakingRoutes = require('./routes/matchmakingRoutes');
const postRoutes = require('./routes/postRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminMessageRoutes = require('./routes/adminMessageRoutes');
const userMessageRoutes = require('./routes/userMessageRoutes');
const healthRoutes = require('./routes/healthRoutes');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Make io instance available to the Express app
app.set('io', io);

// Initialize socket manager
initializeSocket(io);

// Apply global middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io instance and connectedUsers available to all route handlers
app.use((req, res, next) => {
  req.io = io;
  app.set('connectedUsers', connectedUsers);
  next();
});

// Apply rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/interests', interestRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/messages/user', userMessageRoutes);
app.use('/api/matchmaking', matchmakingRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/messages', adminMessageRoutes);
app.use('/api/health', healthRoutes);

// Add route for creating conversation between matched users
app.post('/api/messages/conversations', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = req.user.id;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    // Check if any match exists between the users (regardless of status)
    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('id, status')
      .or(`and(user1_id.eq.${currentUserId},user2_id.eq.${userId}),and(user1_id.eq.${userId},user2_id.eq.${currentUserId})`)
      .limit(1);
    
    if (matchError) {
      console.error('Error checking for match:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Error checking for match'
      });
    }
    
    // If no match exists, create a new one. If match exists, update it if needed
    let matchId;
    if (!matchData || matchData.length === 0) {
      // Create a new match
      const { data: newMatch, error: newMatchError } = await supabase
        .from('matches')
        .insert({
          user1_id: currentUserId,
          user2_id: userId,
          status: 'accepted',
          compatibility_score: 100,
          shared_interests: [],
          created_at: new Date(),
          updated_at: new Date(),
          accepted_at: new Date()
        })
        .select()
        .single();
      
      if (newMatchError) {
        console.error('Error creating match for conversation:', newMatchError);
        return res.status(500).json({
          success: false,
          message: 'Error creating match for conversation'
        });
      }
      
      matchId = newMatch.id;
    } else {
      // Match exists, update if not already accepted
      matchId = matchData[0].id;
      
      if (matchData[0].status !== 'accepted') {
        const { error: updateError } = await supabase
          .from('matches')
          .update({
            status: 'accepted',
            compatibility_score: 100,
            shared_interests: [],
            updated_at: new Date(),
            accepted_at: new Date()
          })
          .eq('id', matchId);
        
        if (updateError) {
          console.error('Error updating existing match:', updateError);
          return res.status(500).json({
            success: false,
            message: 'Error updating existing match'
          });
        }
      }
    }
    
    // Get user details for the conversation
    const { data: otherUser, error: userError } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, profile_picture_url')
      .eq('id', userId)
      .single();
    
    if (userError) {
      console.error('Error fetching user details:', userError);
      return res.status(500).json({
        success: false,
        message: 'Error fetching user details'
      });
    }
    
    return res.status(201).json({
      success: true,
      data: {
        matchId,
        conversation: {
          id: matchId, // Use match ID as conversation ID
          participants: [currentUserId, userId],
          otherUser: {
            id: otherUser.id,
            firstName: otherUser.first_name,
            lastName: otherUser.last_name,
            username: otherUser.username,
            profilePictureUrl: otherUser.profile_picture_url
          },
          updatedAt: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while creating conversation'
    });
  }
});

// Default route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Circle Backend API',
    status: 'Active',
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

// Not found middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Resource not found'
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start health monitoring
  startHealthMonitoring(io);
});

// Export for testing
module.exports = { app, server, io }; 