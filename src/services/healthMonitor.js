/**
 * Health monitoring service
 * Periodically checks system health metrics and logs them to the database
 * Also sends real-time updates via WebSocket
 */

const os = require('os');
const osUtils = require('os-utils');
const supabase = require('../config/database');
const logger = require('../utils/logger');

// Monitor intervals in milliseconds
const MONITOR_INTERVAL = 5 * 60 * 1000; // 5 minutes for database recording
const REALTIME_UPDATE_INTERVAL = 5 * 1000; // 5 seconds for WebSocket updates

// Store reference to Socket.IO instance
let ioInstance = null;

// Store IDs of admin users who are viewing the health dashboard
const adminViewers = new Set();

/**
 * Get current CPU usage
 * @returns {Promise<number>} - CPU usage percentage
 */
const getCpuUsage = () => {
  return new Promise((resolve) => {
    osUtils.cpuUsage(value => {
      resolve(Math.round(value * 100));
    });
  });
};

/**
 * Get memory usage percentage
 * @returns {number} - Memory usage percentage
 */
const getMemoryUsage = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  return Math.round((usedMem / totalMem) * 100);
};

/**
 * Check API server health
 * @returns {string} - Server status
 */
const getApiStatus = () => {
  return 'healthy'; // Assuming if this code runs, API server is healthy
};

/**
 * Get the current websocket server status
 * @param {object} io - Socket.IO instance
 * @returns {object} Websocket status data
 */
const getWebsocketStatus = (io) => {
  return {
    status: io ? 'online' : 'unavailable',
    connections: io ? io.sockets.sockets.size : 0,
    rooms: io ? io.sockets.adapter.rooms.size : 0,
    uptime: process.uptime()
  };
};

/**
 * Check database health
 * @returns {Promise<string>} - Database status
 */
const getDatabaseStatus = async () => {
  try {
    // Simple query to test database connection
    const startTime = Date.now();
    const { data, error } = await supabase
      .from('health_checks')
      .select('id')
      .limit(1);
      
    const responseTime = Date.now() - startTime;
    
    if (error) {
      logger.error(`Database health check failed: ${error.message}`, { responseTime });
      return 'unhealthy';
    }
    
    return 'healthy';
  } catch (error) {
    logger.error(`Database health check error: ${error.message}`);
    return 'unhealthy';
  }
};

/**
 * Get full health metrics for real-time updates
 * @returns {Promise<object>} - Health metrics object
 */
const getHealthMetrics = async () => {
  try {
    // Get all health metrics
    const cpuUsage = await getCpuUsage();
    const memoryUsage = getMemoryUsage();
    const apiStatus = getApiStatus();
    const websocketStatus = getWebsocketStatus(ioInstance);
    const databaseStatus = await getDatabaseStatus();
    
    const metrics = {
      cpu: {
        usage: cpuUsage,
        cores: os.cpus().length,
        model: os.cpus()[0].model,
        speed: os.cpus()[0].speed
      },
      memory: {
        usagePercentage: memoryUsage,
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      apiServer: {
        status: apiStatus,
        uptime: process.uptime()
      },
      websocket: {
        status: websocketStatus,
        connectedClients: ioInstance?.engine?.clientsCount || 0
      },
      system: {
        loadAverage: os.loadavg(),
        platform: process.platform,
        uptime: os.uptime()
      },
      timestamp: new Date().toISOString()
    };
    
    return metrics;
  } catch (error) {
    logger.error(`Error getting health metrics: ${error.message}`);
    return { error: error.message, timestamp: new Date().toISOString() };
  }
};

/**
 * Record health check data in the database
 * @param {object} io - Socket.IO instance (optional)
 */
const recordHealthCheck = async (io) => {
  try {
    // Get all health metrics
    const cpuUsage = await getCpuUsage();
    const memoryUsage = getMemoryUsage();
    const apiStatus = getApiStatus();
    const websocketStatus = getWebsocketStatus(io);
    const databaseStatus = await getDatabaseStatus();
    
    // Record in database
    const { data, error } = await supabase
      .from('health_checks')
      .insert({
        api_status: apiStatus,
        websocket_status: websocketStatus,
        database_status: databaseStatus,
        cpu_usage: cpuUsage,
        memory_usage: memoryUsage,
        checked_at: new Date()
      });
      
    if (error) {
      logger.error(`Failed to record health check: ${error.message}`);
      return false;
    }
    
    logger.info('Health check recorded successfully', { 
      cpuUsage, 
      memoryUsage, 
      apiStatus, 
      websocketStatus, 
      databaseStatus 
    });
    
    return true;
  } catch (error) {
    logger.error(`Health check error: ${error.message}`);
    return false;
  }
};

/**
 * Send real-time health metrics to admin clients
 */
const sendRealTimeHealthUpdates = async () => {
  // Skip if no admin users are viewing the dashboard
  if (adminViewers.size === 0 || !ioInstance) {
    return;
  }
  
  // Get health metrics
  const metrics = await getHealthMetrics();
  
  // Send to each admin viewer using their socket connection
  for (const adminId of adminViewers) {
    const socketId = ioInstance.sockets.adapter.rooms.get(`admin:${adminId}`)?.values().next().value;
    if (socketId) {
      ioInstance.to(socketId).emit('health:update', metrics);
    }
  }
};

/**
 * Register a user as viewing the health dashboard
 * @param {string} userId - User ID
 */
const registerHealthViewer = (userId) => {
  adminViewers.add(userId);
  logger.info(`Admin user ${userId} registered for health updates`);
};

/**
 * Unregister a user from viewing the health dashboard
 * @param {string} userId - User ID
 */
const unregisterHealthViewer = (userId) => {
  adminViewers.delete(userId);
  logger.info(`Admin user ${userId} unregistered from health updates`);
};

/**
 * Start the health monitoring service with real-time updates
 * @param {object} io - Socket.IO instance
 */
const startHealthMonitoring = (io) => {
  // Store reference to Socket.IO
  ioInstance = io;
  
  // Only register socket events if io is available
  if (io) {
    // Register socket events for real-time monitoring
    io.on('connection', (socket) => {
      // Only register these events for authenticated sockets
      if (socket.user) {
        socket.on('health:subscribe', async () => {
          try {
            // Verify this is an admin user
            const { data, error } = await supabase
              .from('users')
              .select('is_admin, role')
              .eq('id', socket.user.id)
              .single();
              
            const isAdmin = data && (data.is_admin === true || data.role === 'admin');
            
            if (error || !isAdmin) {
              socket.emit('error', {
                source: 'health:subscribe',
                message: 'Unauthorized. Admin privileges required.'
              });
              return;
            }
            
            // Join admin-specific room for health updates
            socket.join(`admin:${socket.user.id}`);
            
            // Register as health viewer
            registerHealthViewer(socket.user.id);
            
            // Send immediate health update
            const metrics = await getHealthMetrics();
            socket.emit('health:update', metrics);
            
            // Confirm subscription
            socket.emit('health:subscribed', {
              message: 'Successfully subscribed to real-time health updates',
              updateFrequency: REALTIME_UPDATE_INTERVAL
            });
            
            logger.info(`Admin ${socket.user.id} subscribed to health updates`);
          } catch (error) {
            logger.error(`Health subscription error: ${error.message}`);
            socket.emit('error', {
              source: 'health:subscribe',
              message: 'Failed to subscribe to health updates'
            });
          }
        });
        
        socket.on('health:unsubscribe', () => {
          try {
            // Leave admin-specific room
            socket.leave(`admin:${socket.user.id}`);
            
            // Unregister as health viewer
            unregisterHealthViewer(socket.user.id);
            
            // Confirm unsubscription
            socket.emit('health:unsubscribed', {
              message: 'Successfully unsubscribed from health updates'
            });
            
            logger.info(`Admin ${socket.user.id} unsubscribed from health updates`);
          } catch (error) {
            logger.error(`Health unsubscription error: ${error.message}`);
          }
        });
        
        socket.on('disconnect', () => {
          // Unregister from health updates on disconnect
          unregisterHealthViewer(socket.user.id);
        });
      }
    });
  } else {
    logger.warn('Health monitoring started without Socket.IO - real-time updates disabled');
  }
  
  // Perform initial health check
  recordHealthCheck(io);
  
  // Schedule periodic health checks for database recording
  const databaseInterval = setInterval(() => {
    recordHealthCheck(io);
  }, MONITOR_INTERVAL);
  
  // Schedule frequent updates for real-time monitoring
  const realtimeInterval = setInterval(() => {
    sendRealTimeHealthUpdates();
  }, REALTIME_UPDATE_INTERVAL);
  
  // Return interval IDs for potential cleanup
  return {
    databaseInterval,
    realtimeInterval
  };
};

module.exports = {
  startHealthMonitoring,
  recordHealthCheck,
  getHealthMetrics,
  registerHealthViewer,
  unregisterHealthViewer
}; 