
# Bot Chat API Documentation

## 1. Send Message to Bot

This endpoint allows you to send a message to a bot and receive an immediate response.

**Endpoint:** `POST /api/botchat/send`

**Headers:**
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "botId": "BOT_USER_ID_HERE",
  "message": "Hello bot, how are you?"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "userMessage": {
      "id": "message-uuid-here",
      "senderId": "your-user-id",
      "receiverId": "bot-user-id",
      "message": "Hello bot, how are you?",
      "timestamp": "2025-05-29T12:00:00.000Z",
      "isRead": true
    },
    "botMessage": {
      "id": "bot-message-uuid-here",
      "senderId": "bot-user-id",
      "receiverId": "your-user-id",
      "senderName": "Bot Name",
      "message": "I'm doing well, thank you! How can I help you today?",
      "timestamp": "2025-05-29T12:00:01.000Z",
      "isRead": false
    }
  }
}
```

## 2. Get Conversation with Bot

This endpoint allows you to retrieve the conversation history with a specific bot.

**Endpoint:** `GET /api/botchat/conversation/:botId`

**Headers:**
```
Authorization: Bearer YOUR_JWT_TOKEN
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "message-uuid-1",
      "senderId": "your-user-id",
      "receiverId": "bot-user-id",
      "message": "Hello there!",
      "timestamp": "2025-05-29T11:55:00.000Z",
      "isRead": true
    },
    {
      "id": "message-uuid-2",
      "senderId": "bot-user-id",
      "receiverId": "your-user-id",
      "message": "Hi! How can I help you today?",
      "timestamp": "2025-05-29T11:55:01.000Z",
      "isRead": true
    },
    {
      "id": "message-uuid-3",
      "senderId": "your-user-id",
      "receiverId": "bot-user-id",
      "message": "Tell me about yourself",
      "timestamp": "2025-05-29T11:56:00.000Z",
      "isRead": true
    },
    {
      "id": "message-uuid-4",
      "senderId": "bot-user-id",
      "receiverId": "your-user-id",
      "message": "I'm a friendly AI assistant that loves to chat!",
      "timestamp": "2025-05-29T11:56:01.000Z",
      "isRead": true
    }
  ]
}
```

## Example Usage with JavaScript/Axios

```javascript
// Function to send message to bot
async function sendMessageToBot(botId, message) {
  try {
    const response = await axios.post(
      'https://your-api-url.com/api/botchat/send',
      { botId, message },
      { 
        headers: { 
          Authorization: `Bearer ${YOUR_TOKEN}`,
          'Content-Type': 'application/json' 
        } 
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error sending message to bot:', error);
    throw error;
  }
}

// Function to get conversation history
async function getBotConversation(botId) {
  try {
    const response = await axios.get(
      `https://your-api-url.com/api/botchat/conversation/${botId}`,
      { 
        headers: { 
          Authorization: `Bearer ${YOUR_TOKEN}`
        } 
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error fetching bot conversation:', error);
    throw error;
  }
}
```

This new API provides a simpler, more direct way to communicate with bot users instead of the previous socket-based approach, which was causing issues.
