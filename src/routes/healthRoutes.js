const express = require('express');
const os = require('os');
const osUtils = require('os-utils');
const si = require('systeminformation');
const supabase = require('../config/database');
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Health check endpoint - basic version for public health check
router.get('/check', async (req, res) => {
  try {
    // Simple API server check
    const apiStatus = { status: 'healthy', responseTime: 0 };
    
    // Basic database check
    const startTime = Date.now();
    const { data, error } = await supabase.from('health_checks').select('id').limit(1);
    apiStatus.responseTime = Date.now() - startTime;
    
    const dbStatus = error ? 'unhealthy' : 'healthy';
    
    return res.status(200).json({
      success: true,
      data: {
        api: apiStatus,
        database: dbStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server health check failed'
    });
  }
});

// Detailed system health metrics - admin only
router.get('/detailed', authenticate, isAdmin, async (req, res) => {
  try {
    const startTime = Date.now();
    const healthData = {};
    
    // System CPU usage
    await getCpuUsage().then(cpuData => {
      healthData.cpu = cpuData;
    });
    
    // Memory usage
    healthData.memory = getMemoryUsage();
    
    // API server status
    healthData.apiServer = {
      status: 'healthy',
      uptime: Math.round(process.uptime()),
      responseTime: 0 // Will be set at the end
    };
    
    // Websocket server status
    healthData.websocketServer = await getWebsocketStatus(req);
    
    // Database status
    healthData.database = await getDatabaseStatus();
    
    // System info
    healthData.system = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      hostname: os.hostname()
    };
    
    // Recent logs
    healthData.logs = await getSystemLogs();
    
    // Set final response time
    healthData.apiServer.responseTime = Date.now() - startTime;
    
    return res.status(200).json({
      success: true,
      data: healthData
    });
  } catch (error) {
    console.error('Detailed health check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Detailed health check failed'
    });
  }
});

// Endpoint to get the latest real-time metrics
router.get('/metrics', authenticate, isAdmin, async (req, res) => {
  try {
    const { getHealthMetrics } = require('../services/healthMonitor');
    
    // Get current metrics
    const metrics = await getHealthMetrics();
    
    return res.status(200).json({
      success: true,
      data: metrics,
      message: 'For real-time updates, use WebSocket with the health:subscribe event'
    });
  } catch (error) {
    console.error('Error fetching health metrics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch health metrics'
    });
  }
});

/**
 * Get CPU usage percentage
 */
const getCpuUsage = async () => {
  return new Promise((resolve) => {
    osUtils.cpuUsage(function(value) {
      si.currentLoad().then(data => {
        resolve({
          usage: Math.round(value * 100),
          averageLoad: data.avgLoad,
          currentLoad: Math.round(data.currentLoad),
          coresUsage: data.cpus.map(cpu => Math.round(cpu.load)),
          cores: os.cpus().length
        });
      }).catch(error => {
        resolve({
          usage: Math.round(value * 100),
          cores: os.cpus().length,
          error: error.message
        });
      });
    });
  });
};

/**
 * Get memory usage metrics
 */
const getMemoryUsage = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const processMemory = process.memoryUsage();
  
  return {
    total: formatBytes(totalMem),
    free: formatBytes(freeMem),
    used: formatBytes(usedMem),
    usagePercentage: Math.round((usedMem / totalMem) * 100),
    process: {
      rss: formatBytes(processMemory.rss),
      heapTotal: formatBytes(processMemory.heapTotal),
      heapUsed: formatBytes(processMemory.heapUsed),
      external: formatBytes(processMemory.external)
    }
  };
};

/**
 * Get websocket server status
 */
const getWebsocketStatus = async (req) => {
  try {
    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    
    if (!io) {
      return {
        status: 'unhealthy',
        error: 'Socket.IO instance not found'
      };
    }
    
    const socketRooms = [...io.sockets.adapter.rooms.keys()].filter(room => !room.includes('#'));
    
    return {
      status: 'healthy',
      connectedClients: io.engine?.clientsCount || 0,
      activeUsers: connectedUsers ? connectedUsers.size : 0,
      activeRooms: socketRooms.length
    };
  } catch (error) {
    console.error('Error getting websocket status:', error);
    return {
      status: 'unknown',
      error: error.message
    };
  }
};

/**
 * Get database connection status and metrics
 */
const getDatabaseStatus = async () => {
  try {
    // Get database connection info
    const startTime = Date.now();
    const { data, error } = await supabase.rpc('get_db_stats');
    const responseTime = Date.now() - startTime;
    
    if (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime
      };
    }
    
    // Get storage info (simplified - actual implementation would depend on Supabase tier)
    const { data: storageData, error: storageError } = await supabase
      .from('storage_usage')
      .select('*')
      .limit(1)
      .maybeSingle();
      
    // Get recent queries (if tracking table exists)
    const { data: recentQueries, error: queriesError } = await supabase
      .from('query_log')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(10);
      
    return {
      status: 'healthy',
      responseTime,
      connections: data ? {
        active: data.active_connections,
        idle: data.idle_connections,
        total: data.total_connections,
        maxConnections: data.max_connections
      } : null,
      storage: storageData || {
        usedBytes: 'Not available',
        totalBytes: 'Not available'  
      },
      lastQueries: !queriesError && recentQueries ? recentQueries : []
    };
  } catch (error) {
    console.error('Error getting database status:', error);
    return {
      status: 'error',
      error: error.message
    };
  }
};

/**
 * Get recent system logs
 */
const getSystemLogs = async () => {
  try {
    // Check for log files in the logs directory
    const logDir = path.join(process.cwd(), 'logs');
    const logFiles = [];
    
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir)
        .filter(file => file.endsWith('.log'))
        .sort((a, b) => {
          return fs.statSync(path.join(logDir, b)).mtime.getTime() - 
                 fs.statSync(path.join(logDir, a)).mtime.getTime();
        })
        .slice(0, 5);  // Get 5 most recent logs
      
      for (const file of files) {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        // Get last 50 lines from log file
        let content = '';
        
        if (stats.size > 0) {
          // Read last 10KB of the file to get recent logs
          const buffer = Buffer.alloc(Math.min(10 * 1024, stats.size));
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, stats.size - buffer.length));
          fs.closeSync(fd);
          
          content = buffer.toString('utf8')
            .split('\n')
            .filter(Boolean)
            .slice(-50)  // Get last 50 lines
            .join('\n');
        }
        
        logFiles.push({
          name: file,
          size: formatBytes(stats.size),
          lastModified: stats.mtime,
          recentEntries: content
        });
      }
    }
    
    // Also collect recent console logs from custom buffer if available
    const inMemoryLogs = global.logBuffer ? 
      global.logBuffer.slice(-50) : 
      ['No in-memory logs available'];
    
    return {
      logFiles,
      inMemoryLogs
    };
  } catch (error) {
    console.error('Error reading system logs:', error);
    return {
      error: error.message
    };
  }
};

/**
 * Format bytes to human-readable format
 */
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

module.exports = router; 