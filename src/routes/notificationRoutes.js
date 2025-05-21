const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const notificationController = require('../controllers/notificationController');

// All notification routes require authentication
router.use(authenticate);

// Get user notifications
router.get('/', notificationController.getUserNotifications);

// Mark notification as read
router.put('/:notificationId/read', notificationController.markNotificationAsRead);

// Delete notification
router.delete('/:notificationId', notificationController.deleteNotification);

// Mark all notifications as read
router.put('/read-all', notificationController.markAllNotificationsAsRead);

// Get unread notification count
router.get('/count', notificationController.getUnreadCount);

module.exports = router; 