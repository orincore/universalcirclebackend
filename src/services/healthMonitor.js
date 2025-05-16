/**
 * Health monitoring service
 * Periodically checks system health metrics and logs them to the database
 */

const os = require('os');
const osUtils = require('os-utils');
const supabase = require('../config/database');
const logger = require('../utils/logger');

// Monitor interval in milliseconds
const MONITOR_INTERVAL = 5 * 60 * 1000; // 5 minutes

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
 * Check websocket server health
 * @param {object} io - Socket.IO instance
 * @returns {string} - Websocket status
 */
const getWebsocketStatus = (io) => {
  return io ? 'healthy' : 'unhealthy';
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
 * Record health check data in the database
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
 * Start the health monitoring service
 * @param {object} io - Socket.IO instance
 */
const startHealthMonitoring = (io) => {
  // Perform initial health check
  recordHealthCheck(io);
  
  // Schedule periodic health checks
  const interval = setInterval(() => {
    recordHealthCheck(io);
  }, MONITOR_INTERVAL);
  
  // Return interval ID for potential cleanup
  return interval;
};

module.exports = {
  startHealthMonitoring,
  recordHealthCheck
}; 