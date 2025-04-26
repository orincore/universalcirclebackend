# Circle Frontend Development Guide

This document provides comprehensive instructions for setting up and developing frontend applications (iOS, Android, Web, macOS, Windows, Linux) that connect to the Circle backend.

## Table of Contents
- [Overview](#overview)
- [API Base URL](#api-base-url)
- [Setting Up](#setting-up)
  - [Web](#web)
  - [iOS](#ios)
  - [Android](#android)
  - [macOS/Windows/Linux](#macos-windows-linux)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
- [Real-time Integration](#real-time-integration)
- [File Upload Workflows](#file-upload-workflows)
- [Error Handling](#error-handling)
- [Example Code](#example-code)

## Overview

Circle is a social platform that offers:
- User authentication and profile management
- Interest-based matchmaking
- Real-time messaging
- Media posts and interactions
- User search and discovery
- Analytics

The backend is built with Node.js, Express, Socket.IO, and integrates with Supabase and AWS S3. Frontend applications must handle authentication, real-time connections, and media uploads.

## API Base URL

The base URL for all API endpoints is:
```
http://localhost:5000/api
```

In production, replace with your deployed API URL.

## Setting Up

### Web

#### Prerequisites
- Node.js 14+
- npm or yarn
- Modern browser

#### Setup Instructions

1. Create a new React project:
```bash
npx create-react-app circle-web
cd circle-web
```

2. Install necessary dependencies:
```bash
npm install axios socket.io-client jwt-decode formik yup react-router-dom @emotion/react
```

3. Create an `.env` file:
```
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_SOCKET_URL=http://localhost:5000
```

4. Set up folder structure:
```
src/
  assets/
  components/
  contexts/
  hooks/
  pages/
  services/
    api.js
    socket.js
    auth.js
  utils/
```

5. Create a basic API service (`src/services/api.js`):
```javascript
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for adding the auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
```

### iOS

#### Prerequisites
- Xcode 13+
- Swift 5+
- iOS 15+ target
- CocoaPods or Swift Package Manager

#### Setup Instructions

1. Create a new iOS project in Xcode
2. Set up dependencies using Swift Package Manager:
   - Alamofire (networking)
   - Socket.IO-Client-Swift (real-time)
   - KeychainAccess (secure token storage)
   - Kingfisher (image loading)

3. Create API and WebSocket managers:

```swift
// APIManager.swift
import Foundation
import Alamofire

class APIManager {
    static let shared = APIManager()
    
    private let baseURL = "http://localhost:5000/api"
    
    func setAuthToken(_ token: String) {
        // Store in Keychain
    }
    
    func request<T: Decodable>(_ endpoint: String, 
                              method: HTTPMethod = .get, 
                              parameters: Parameters? = nil, 
                              completion: @escaping (Result<T, Error>) -> Void) {
        // Implementation
    }
}
```

### Android

#### Prerequisites
- Android Studio
- Kotlin
- Minimum SDK 21 (Android 5.0)

#### Setup Instructions

1. Create a new Android project in Android Studio
2. Add dependencies to `build.gradle`:
   - Retrofit (networking)
   - Socket.IO client (real-time)
   - Glide (image loading)
   - Coroutines (async operations)
   - Navigation Components
   - ViewModel and LiveData

3. Create API and Socket managers:

```kotlin
// ApiService.kt
interface ApiService {
    @POST("auth/login")
    suspend fun login(@Body loginRequest: LoginRequest): Response<AuthResponse>
    
    // Other API methods
}

// RetrofitClient.kt
object RetrofitClient {
    private const val BASE_URL = "http://localhost:5000/api/"
    
    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val request = chain.request().newBuilder()
            val token = TokenManager.getToken()
            if (token != null) {
                request.addHeader("Authorization", "Bearer $token")
            }
            chain.proceed(request.build())
        }
        .build()
        
    val instance: ApiService by lazy {
        val retrofit = Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            
        retrofit.create(ApiService::class.java)
    }
}
```

### macOS/Windows/Linux

For desktop applications, consider using:

- Electron.js (JavaScript)
- Flutter (Dart)
- Qt (C++)

Setup will vary based on your choice, but connection to the APIs will follow similar patterns to the web implementation.

## Authentication

### Registration
```
POST /api/auth/register
```

Request Body:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "username": "johndoe",
  "email": "john@example.com",
  "phoneNumber": "+1234567890",
  "password": "securePassword123",
  "dateOfBirth": "1990-01-01",
  "gender": "Male",
  "preference": "Dating",
  "location": {"latitude": 37.7749, "longitude": -122.4194},
  "interests": ["Sports", "Music", "Technology"]
}
```

Response:
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "user_id",
      "firstName": "John",
      "lastName": "Doe",
      "username": "johndoe",
      "email": "john@example.com"
    }
  }
}
```

### Login
```
POST /api/auth/login
```

Request Body:
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

Response:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "user_id",
      "firstName": "John",
      "lastName": "Doe",
      "username": "johndoe",
      "email": "john@example.com"
    }
  }
}
```

### Get Current User
```
GET /api/auth/me
```

Headers:
```
Authorization: Bearer jwt_token_here
```

Response:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "firstName": "John",
      "lastName": "Doe",
      "username": "johndoe",
      "email": "john@example.com",
      "profilePictureUrl": "https://example.com/profile.jpg",
      "interests": ["Sports", "Music", "Technology"]
    }
  }
}
```

## API Endpoints

### Interests
- `GET /api/interests` - Get all interests categories

### Profile Management
- `PUT /api/profile` - Update user profile
- `GET /api/profile/profile-picture-upload-url` - Get profile picture upload URL
- `PUT /api/profile/profile-picture` - Update profile picture URL

### User Search
- `GET /api/users/search?query=username` - Search users by name/username
- `GET /api/users/:userId` - Get user profile by ID

### Messaging
- `POST /api/messages` - Send message
- `GET /api/messages/conversation/:userId` - Get conversation with user
- `GET /api/messages/conversations` - Get all conversations
- `POST /api/messages/media-upload-url` - Get message media upload URL

### Matchmaking
- `POST /api/matchmaking/start` - Start matchmaking
- `POST /api/matchmaking/cancel` - Cancel matchmaking
- `POST /api/matchmaking/respond` - Respond to a match
- `GET /api/matchmaking/pending` - Get pending matches

### Posts
- `POST /api/posts` - Create post
- `GET /api/posts/feed` - Get feed posts
- `GET /api/posts/user/:userId` - Get user posts
- `GET /api/posts/:postId` - Get single post
- `POST /api/posts/media-upload-url` - Get post media upload URL
- `POST /api/posts/:postId/comments` - Add comment
- `GET /api/posts/:postId/comments` - Get post comments
- `POST /api/posts/:postId/react` - React to post

### Analytics
- `GET /api/analytics/user` - Get user analytics
- `GET /api/analytics/app` - Get app analytics (admin only)

## Real-time Integration

### Socket.IO Connection

1. Connect with authentication:

```javascript
// Web example
import io from 'socket.io-client';

const connectSocket = (token) => {
  const socket = io('http://localhost:5000', {
    auth: {
      token
    }
  });
  
  socket.on('connect', () => {
    console.log('Connected to Socket.IO server');
  });
  
  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });
  
  return socket;
};
```

### Supported Events

1. User Status:
   - `user:status` - User online/offline status

2. Messaging:
   - `message:send` - Send a message
   - `message:sent` - Confirmation of sent message
   - `message:received` - New message received
   - `message:read` - Message read receipt
   - `typing:start` - User started typing
   - `typing:stop` - User stopped typing

3. Matchmaking:
   - `match:accepted` - Match was accepted

## File Upload Workflows

### Profile Picture Upload

1. Request a pre-signed URL:
```
GET /api/profile/profile-picture-upload-url
```

2. Upload file to the URL using a PUT request with correct content-type.

3. Update profile with the new picture URL:
```
PUT /api/profile/profile-picture
```
Request Body:
```json
{
  "profilePictureUrl": "https://bucket-name.s3.region.amazonaws.com/path/to/image.jpg"
}
```

### Post Media Upload

1. Request a pre-signed URL:
```
POST /api/posts/media-upload-url
```
Request Body:
```json
{
  "mediaType": "image",
  "contentType": "image/jpeg"
}
```

2. Upload file to the URL using a PUT request.

3. Create post with the media URL:
```
POST /api/posts
```
Request Body:
```json
{
  "caption": "My new post",
  "mediaType": "image",
  "mediaUrl": "https://bucket-name.s3.region.amazonaws.com/path/to/image.jpg",
  "tags": ["fun", "vacation"]
}
```

## Error Handling

The API returns error responses in this format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

Common HTTP status codes:
- 400: Bad Request (validation error)
- 401: Unauthorized (missing/invalid token)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 500: Server Error

## Example Code

### Authentication Flow (React)

```jsx
import React, { useState } from 'react';
import api from '../services/api';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    
    try {
      const response = await api.post('/auth/login', { email, password });
      
      if (response.data.success) {
        // Store token
        localStorage.setItem('token', response.data.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.data.user));
        
        // Redirect
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    }
  };
  
  return (
    <form onSubmit={handleLogin}>
      {error && <div className="error">{error}</div>}
      <div>
        <label>Email</label>
        <input 
          type="email" 
          value={email} 
          onChange={(e) => setEmail(e.target.value)} 
          required 
        />
      </div>
      <div>
        <label>Password</label>
        <input 
          type="password" 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          required 
        />
      </div>
      <button type="submit">Login</button>
    </form>
  );
};

export default Login;
```

### Chat Component (React)

```jsx
import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import io from 'socket.io-client';

const Chat = ({ userId, recipientId }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [socket, setSocket] = useState(null);
  const messagesEndRef = useRef(null);
  
  // Load previous messages
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await api.get(`/messages/conversation/${recipientId}`);
        if (response.data.success) {
          setMessages(response.data.data.messages);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };
    
    fetchMessages();
  }, [recipientId]);
  
  // Connect to socket
  useEffect(() => {
    const token = localStorage.getItem('token');
    const newSocket = io('http://localhost:5000', {
      auth: { token }
    });
    
    newSocket.on('connect', () => {
      console.log('Connected to socket');
    });
    
    newSocket.on('message:received', (message) => {
      if (message.sender_id === recipientId) {
        setMessages(prev => [...prev, message]);
      }
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.disconnect();
    };
  }, [recipientId]);
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;
    
    socket.emit('message:send', {
      receiverId: recipientId,
      content: newMessage
    });
    
    setNewMessage('');
  };
  
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((message) => (
          <div 
            key={message.id} 
            className={`message ${message.sender_id === userId ? 'sent' : 'received'}`}
          >
            <p>{message.content}</p>
            <span className="time">
              {new Date(message.created_at).toLocaleTimeString()}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={sendMessage} className="message-form">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
};

export default Chat;
```

### iOS API/Socket Integration

```swift
// iOS Socket Manager
import Foundation
import SocketIO

class SocketManager {
    static let shared = SocketManager()
    
    private var socket: SocketIOClient?
    private var manager: SocketManager?
    
    func connect(withToken token: String) {
        let manager = SocketManager(socketURL: URL(string: "http://localhost:5000")!, config: [.log(true), .compress])
        
        socket = manager.defaultSocket
        
        socket?.on(clientEvent: .connect) { _, _ in
            print("Socket connected")
        }
        
        socket?.on(clientEvent: .error) { data, _ in
            print("Socket error: \(data)")
        }
        
        socket?.on("message:received") { [weak self] data, _ in
            guard let messageData = data[0] as? [String: Any] else { return }
            // Handle received message
        }
        
        // Connect with authentication
        socket?.connect(withPayload: ["token": token])
    }
    
    func disconnect() {
        socket?.disconnect()
    }
    
    func sendMessage(to receiverId: String, content: String, completion: @escaping (Bool) -> Void) {
        socket?.emit("message:send", ["receiverId": receiverId, "content": content])
        completion(true)
    }
}
```
