/**
 * Notification routes
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const {
  getUserNotifications,
  markNotificationAsRead,
  deleteNotification,
  markAllNotificationsAsRead,
  getUnreadCount,
  registerDeviceToken,
  unregisterDeviceToken,
  getNotificationSettings,
  updateNotificationSettings,
  sendTestNotification
} = require('../controllers/notificationController');

// All notification routes require authentication
router.use(authenticate);

// User notification routes
router.get('/', getUserNotifications);
router.get('/unread/count', getUnreadCount);
router.patch('/:notificationId/read', markNotificationAsRead);
router.delete('/:notificationId', deleteNotification);
router.patch('/read-all', markAllNotificationsAsRead);

// Push notification device token routes
router.post('/device-token', registerDeviceToken);
router.delete('/device-token', unregisterDeviceToken);

// Notification settings routes
router.get('/settings', getNotificationSettings);
router.patch('/settings', updateNotificationSettings);

// Test notification route (for development/testing)
router.post('/test', sendTestNotification);

module.exports = router; 