# Firebase Cloud Messaging Setup for Universal Circle

This document describes how to set up and use Firebase Cloud Messaging (FCM) for push notifications in the Universal Circle application.

## Setup Requirements

1. **Firebase Project**:
   - Create a new Firebase project at [Firebase Console](https://console.firebase.google.com)
   - Add both Android and iOS apps to your project

2. **Service Account**:
   - Go to Project Settings > Service accounts
   - Generate a new private key (JSON file)
   - Securely store this file

3. **Environment Variables**:
   - Set up one of the following environment variables:
     - `FIREBASE_SERVICE_ACCOUNT` - JSON string of the service account credentials
     - `FIREBASE_SERVICE_ACCOUNT_PATH` - Path to the service account file

## Database Tables

The following tables are used for notifications:

1. **device_tokens**: Stores FCM tokens for user devices
   - Columns: `id`, `user_id`, `token`, `device_type`, `device_name`, `app_version`, `created_at`, `updated_at`

2. **user_notification_settings**: Stores user notification preferences
   - Columns: `user_id`, `messages_enabled`, `matches_enabled`, `likes_enabled`, `system_enabled`, `promotional_enabled`

3. **admin_notifications**: Tracks broadcast notifications sent by admins
   - Columns: `id`, `title`, `body`, `data`, `sent_at`, `success_count`, `failure_count`, `sent_by`

## API Endpoints

### User Notification Settings

#### Register Device Token
- **URL**: `POST /api/notifications/device-token`
- **Auth**: Required
- **Body**:
  ```json
  {
    "token": "fcm-token-from-device",
    "deviceType": "android|ios|web",
    "deviceName": "Device Name",
    "appVersion": "1.0.0"
  }
  ```

#### Unregister Device Token
- **URL**: `DELETE /api/notifications/device-token`
- **Auth**: Required
- **Body**:
  ```json
  {
    "token": "fcm-token-to-remove"
  }
  ```

#### Get Notification Settings
- **URL**: `GET /api/notifications/settings`
- **Auth**: Required

#### Update Notification Settings
- **URL**: `PATCH /api/notifications/settings`
- **Auth**: Required
- **Body**:
  ```json
  {
    "messages_enabled": true|false,
    "matches_enabled": true|false,
    "likes_enabled": true|false,
    "system_enabled": true|false,
    "promotional_enabled": true|false
  }
  ```

#### Send Test Notification
- **URL**: `POST /api/notifications/test`
- **Auth**: Required

### Admin Broadcast Notifications

#### Send Broadcast Notification (Admin only)
- **URL**: `POST /api/admin/notifications/broadcast`
- **Auth**: Admin required
- **Body**:
  ```json
  {
    "title": "Notification Title",
    "body": "Notification Message Body",
    "data": {
      "customKey1": "customValue1",
      "customKey2": "customValue2"
    },
    "senderName": "Custom Sender Name"
  }
  ```

#### Get All Broadcast Notifications (Admin only)
- **URL**: `GET /api/admin/notifications/broadcasts`
- **Auth**: Admin required
- **Query Params**:
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20)

## Client Implementation

### Android/iOS Apps

1. Add Firebase SDK to your mobile app
2. Request notification permissions
3. Get the FCM token
4. Send the token to the server using the register endpoint
5. Handle incoming notifications

Example code for registering a token:
```javascript
// After getting the FCM token from Firebase
async function registerDeviceToken(token) {
  try {
    const response = await fetch('/api/notifications/device-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        token,
        deviceType: 'android', // or 'ios', 'web'
        deviceName: 'My Device',
        appVersion: '1.0.0'
      })
    });
    
    const data = await response.json();
    console.log('Token registered:', data);
  } catch (error) {
    console.error('Error registering token:', error);
  }
}
```

## Notification Types

The system supports several notification types:

1. **Message Notifications**: Sent when a user receives a message and is offline
2. **Admin Broadcasts**: System-wide announcements sent by administrators
3. **Match Notifications**: Sent when a user gets a new match
4. **Like Notifications**: Sent when a user receives a like

## Troubleshooting

Common issues:

1. **Missing Service Account**: Ensure the Firebase service account is properly configured
2. **Invalid Tokens**: The system automatically removes invalid tokens
3. **No Notifications**: Check user notification settings and device token registration

## Migration

To set up the notification system, run the migration:

```bash
node src/migrations/run.js notification_tables
``` 