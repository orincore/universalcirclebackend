# Firebase Notifications for Universal Circle

This document provides an overview of the Firebase Cloud Messaging (FCM) implementation in Universal Circle for push notifications.

## Setup Instructions

### 1. Firebase Project Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Register your Android and iOS apps
3. Download the configuration files:
   - `google-services.json` for Android
   - `GoogleService-Info.plist` for iOS
4. Generate a Firebase Admin SDK service account key:
   - Go to Project Settings > Service Accounts
   - Click "Generate new private key"
   - Store this file securely

### 2. Environment Variables

Add the following environment variables to your `.env` file:

```
# Option 1: Provide the JSON contents directly
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"your-project-id",...}

# Option 2: Provide a path to the JSON file
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/firebase-service-account.json
```

### 3. Database Migration

Run the migration to create the necessary tables:

```bash
node src/migrations/run.js notification_tables
```

## Features Implemented

### 1. Message Notifications

- Push notifications for chat messages when recipient is offline
- Customizable via user notification settings

### 2. Admin Broadcast Notifications

- Admin panel endpoints for sending broadcasts to all users
- Admin dashboard for viewing broadcast history

### 3. Device Token Management

- API endpoints for registering and unregistering device tokens
- Automatic cleanup of invalid tokens

### 4. User Notification Settings

- User-controlled notification preferences
- Settings for different notification types (messages, matches, etc.)

## API Endpoints

### User Endpoints

- `POST /api/notifications/device-token` - Register device token
- `DELETE /api/notifications/device-token` - Unregister device token
- `GET /api/notifications/settings` - Get notification settings
- `PATCH /api/notifications/settings` - Update notification settings
- `POST /api/notifications/test` - Send test notification

### Admin Endpoints

- `POST /api/admin/notifications/broadcast` - Send broadcast notification
- `GET /api/admin/notifications/broadcasts` - Get broadcast history

## Firebase Admin SDK Integration

The system uses the Firebase Admin SDK for server-side operations:

1. `src/services/firebase/firebaseAdmin.js` - Firebase Admin SDK initialization
2. `src/services/firebase/notificationService.js` - Notification sending functionality

## Socket.IO Integration

The WebSocket server sends push notifications when:

1. A user receives a message but is offline
2. Additional notification events can be added as needed

## Mobile Client Integration

To integrate with mobile apps:

1. Install Firebase SDK in the client app
2. Request notification permissions
3. Get the FCM token
4. Register the token with `/api/notifications/device-token`
5. Handle incoming notifications

## Database Schema

### Tables Created

1. `device_tokens` - Stores FCM tokens for each user's devices
2. `user_notification_settings` - User notification preferences
3. `admin_notifications` - History of admin broadcast notifications

## Documentation

For detailed implementation information, see:

- `docs/firebase-notifications.md` - Full documentation
- Comment blocks in the relevant code files 