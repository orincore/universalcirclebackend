// Import scheduled notifications
const { initializeScheduledNotifications } = require('./services/notification/scheduledNotifications');

// Initialize after server starts
server.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  
  // Initialize socket connections
  initializeSocket(server);
  
  // Initialize scheduled notifications including AI-powered re-engagement notifications
  initializeScheduledNotifications();
  
  logger.info('All services initialized successfully');
}); 