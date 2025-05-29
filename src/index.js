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

// Import and run database migrations
const { runMigrations } = require('./database/runMigrations');

// Import scheduled notifications
const { initializeScheduledNotifications } = require('./services/notification/scheduledNotifications');
const { initializeStreakNotifications } = require('./services/notification/streakNotifications');
const { initializeWheelNotifications } = require('./services/notification/wheelNotifications');

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
const adminAnalyticsRoutes = require('./routes/adminAnalyticsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const adminReportRoutes = require('./routes/adminReportRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const achievementRoutes = require('./routes/achievementRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const adminVerificationRoutes = require('./routes/adminVerificationRoutes');
const streakRoutes = require('./routes/streakRoutes');
const wheelRoutes = require('./routes/wheelRoutes');
const gameRoutes = require('./routes/gameRoutes');
const memeRoutes = require('./routes/memeRoutes');
const apiKeyRoutes = require('./routes/apiKeyRoutes');
const adminApiKeyRoutes = require('./routes/adminApiKeyRoutes');
const botChatRoutes = require('./routes/botChatRoutes');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Improve reliability with better transport and timeout settings
  transports: ['websocket', 'polling'],  // Prefer WebSocket but fallback to polling
  allowUpgrades: true,                   // Allow transport upgrades
  connectTimeout: 45000,                 // Longer connection timeout (45 seconds)
  maxHttpBufferSize: 1e6,                // 1 MB max HTTP buffer size
  pingInterval: 15000,                   // Keep reasonable ping interval
  pingTimeout: 30000,                    // Reasonable ping timeout
  // Reconnection is mainly handled on the client, but server supports it
  cookie: {
    name: "io",                         
    httpOnly: true,
    sameSite: "strict",
    maxAge: 86400000                     // 24 hours
  }
});

// Make io instance available to the Express app
app.set('io', io);

// Initialize socket manager
initializeSocket(io);

// Initialize scheduled notifications
initializeScheduledNotifications();

// Initialize streak notifications
initializeStreakNotifications();

// Initialize wheel notifications
initializeWheelNotifications();

// Apply global middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'static')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Add request tracking for monitoring high-traffic endpoints
const requestStats = {};
app.use((req, res, next) => {
  const endpoint = `${req.method} ${req.path}`;
  requestStats[endpoint] = (requestStats[endpoint] || 0) + 1;
  
  // Log every 100 requests to identify hotspots
  if (Object.values(requestStats).reduce((a, b) => a + b, 0) % 100 === 0) {
    logger.info('REQUEST STATS:', requestStats);
  }
  next();
});

// Make io instance and connectedUsers available to all route handlers
app.use((req, res, next) => {
  req.io = io;
  app.set('connectedUsers', connectedUsers);
  next();
});

// Apply different rate limiting based on endpoint types
// Global rate limiter (more permissive)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Increased from 100 to 300
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

// Stricter rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Stricter limit for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many auth attempts from this IP, please try again later.'
});

// Apply limiters to different routes
app.use('/', globalLimiter); // Default global limiter

// API Routes with appropriate limiters
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/interests', interestRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/messages/user', userMessageRoutes);
app.use('/api/matchmaking', matchmakingRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin/auth', authLimiter, adminAuthRoutes);
app.use('/api/admin/messages', adminMessageRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin/reports', adminReportRoutes);
app.use('/api/admin/verification', adminVerificationRoutes);
app.use('/api/admin/keys', adminApiKeyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/streaks', streakRoutes);
app.use('/api/wheel', wheelRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/memes', memeRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/botchat', botChatRoutes);

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
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Run database migrations
  try {
    await runMigrations();
    console.log('Database migrations completed.');
  } catch (error) {
    console.error('Error running migrations:', error);
  }
  
  // Start health monitoring
  startHealthMonitoring(io);
});

// Export for testing
module.exports = { app, server, io }; 