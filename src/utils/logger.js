const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create log file streams
const date = new Date().toISOString().split('T')[0];
const errorLogStream = fs.createWriteStream(path.join(logsDir, `error-${date}.log`), { flags: 'a' });
const combinedLogStream = fs.createWriteStream(path.join(logsDir, `combined-${date}.log`), { flags: 'a' });

// Create in-memory buffer for recent logs
const MAX_LOG_BUFFER_SIZE = 500;
global.logBuffer = [];

// Create a custom logger with multiple transports
const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  }
});

// Custom log function that also maintains the in-memory buffer
const log = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta
  };
  
  // Write to appropriate log file
  const logString = JSON.stringify(logEntry) + '\n';
  
  if (level === 'error' || level === 'fatal') {
    errorLogStream.write(logString);
  }
  
  combinedLogStream.write(logString);
  
  // Add to in-memory buffer
  global.logBuffer.push(logEntry);
  
  // Trim buffer if it gets too large
  if (global.logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    global.logBuffer = global.logBuffer.slice(-MAX_LOG_BUFFER_SIZE);
  }
  
  // Log using pino
  logger[level](logEntry);
  
  return logEntry;
};

// Wrapper functions for different log levels
const info = (message, meta) => log('info', message, meta);
const debug = (message, meta) => log('debug', message, meta);
const warn = (message, meta) => log('warn', message, meta);
const error = (message, meta) => log('error', message, meta);
const fatal = (message, meta) => log('fatal', message, meta);

// Override console.log to also add to our buffer
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

console.log = function() {
  const args = Array.from(arguments);
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ');
  
  info(message);
  originalConsoleLog.apply(console, arguments);
};

console.error = function() {
  const args = Array.from(arguments);
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ');
  
  error(message);
  originalConsoleError.apply(console, arguments);
};

console.warn = function() {
  const args = Array.from(arguments);
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ');
  
  warn(message);
  originalConsoleWarn.apply(console, arguments);
};

console.info = function() {
  const args = Array.from(arguments);
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  ).join(' ');
  
  info(message);
  originalConsoleInfo.apply(console, arguments);
};

// Export the logger functions
module.exports = {
  logger,
  info,
  debug,
  warn,
  error,
  fatal,
  getRecentLogs: () => global.logBuffer.slice(-50)
}; 