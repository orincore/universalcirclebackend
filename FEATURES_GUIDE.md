# UniversalCircle Features Guide

This document provides a comprehensive overview of all features in the UniversalCircle backend, including setup instructions and frontend integration guides.

## Table of Contents
1. [Setup](#setup)
2. [Authentication](#authentication)
3. [Real-Time Messaging](#real-time-messaging)
4. [Matchmaking](#matchmaking)
5. [Notification System](#notification-system)
6. [Achievement & Streak System](#achievement-streak-system)
7. [AI-Powered Features](#ai-powered-features)
8. [Profile Management](#profile-management)
9. [Verified Profiles](#verified-profiles)
10. [Voice Bio](#voice-bio)
11. [Admin Features](#admin-features)

## Setup

### Environment Variables

Create a `.env` file in the root directory with these variables:

```
PORT=5000
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_key
JWT_SECRET=your_jwt_secret
JWT_EXPIRY=7d
GEMINI_API_KEY=your_google_api_key
```

### Dependencies

Install required dependencies:

```bash
npm install
```

### Starting the Server

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start
```

## Authentication

### Frontend Integration

#### User Registration

```javascript
const registerUser = async (userData) => {
  try {
    const response = await fetch('http://localhost:5000/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userData),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

// Usage
const userData = {
  username: 'newuser',
  email: 'user@example.com',
  password: 'securepassword',
  firstName: 'John',
  lastName: 'Doe',
};

const result = await registerUser(userData);
```

#### User Login

```javascript
const loginUser = async (credentials) => {
  try {
    const response = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store token in secure storage
      localStorage.setItem('authToken', data.token);
    }
    
    return data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

// Usage
const credentials = {
  email: 'user@example.com',
  password: 'securepassword',
};

const result = await loginUser(credentials);
```

### Token Management

Store the token securely and include it in API requests:

```javascript
// Fetch API with auth token
const fetchWithAuth = async (url, options = {}) => {
  const token = localStorage.getItem('authToken');
  
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };
  
  return fetch(url, {
    ...options,
    headers,
  });
};
```

## Real-Time Messaging

### Socket.IO Configuration

```javascript
import { io } from 'socket.io-client';

// Initialize socket connection
const initializeSocket = (token) => {
  const socket = io('http://localhost:5000', {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000,
  });
  
  return socket;
};
```

### Connection Management

```javascript
// Connect and handle events
const connectSocket = (token) => {
  const socket = initializeSocket(token);
  
  // Connection events
  socket.on('connect', () => {
    console.log('Socket connected');
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    
    // Implement reconnection with exponential backoff
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    
    const attemptReconnect = () => {
      if (reconnectAttempts < maxReconnectAttempts) {
        const timeout = Math.min(1000 * (2 ** reconnectAttempts), 30000);
        setTimeout(() => {
          console.log(`Attempting reconnection (${reconnectAttempts + 1})`);
          socket.connect();
          reconnectAttempts++;
        }, timeout);
      }
    };
    
    if (reason === 'transport error' || reason === 'io server disconnect') {
      attemptReconnect();
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
  });
  
  socket.on('error', (errorData) => {
    console.error('Socket error:', errorData);
  });
  
  // Heartbeat mechanism to keep connection alive
  socket.on('heartbeat', (data) => {
    socket.emit('ping:response', { time: data.time });
  });
  
  socket.on('ping:check', (data, callback) => {
    callback({ time: Date.now() });
  });
  
  return socket;
};
```

### Sending & Receiving Messages

```javascript
// Send a message
const sendMessage = (socket, receiverId, content, mediaUrl = null) => {
  return new Promise((resolve, reject) => {
    socket.emit('message:send', {
      receiverId,
      content,
      mediaUrl
    }, (response) => {
      if (response.success) {
        resolve(response);
      } else {
        reject(new Error(response.error.message || 'Failed to send message'));
      }
    });
  });
};

// Receive messages
socket.on('message:received', (message) => {
  console.log('New message received:', message);
  // Update UI with new message
});

// Mark message as read
const markMessageAsRead = (socket, messageId, conversationId) => {
  socket.emit('message:markRead', { messageId, conversationId });
};

// Listen for read receipts
socket.on('message:read', (data) => {
  console.log('Message read:', data.messageId);
  // Update UI to show read status
});
```

### Typing Indicators

```javascript
// Send typing indicator
const sendTypingIndicator = (socket, receiverId, isTyping = true) => {
  socket.emit(isTyping ? 'typing:start' : 'typing:stop', { receiverId });
};

// Listen for typing indicators
socket.on('typing:start', (data) => {
  console.log(`${data.userId} is typing...`);
  // Show typing indicator in UI
});

socket.on('typing:stop', (data) => {
  console.log(`${data.userId} stopped typing`);
  // Hide typing indicator in UI
});
```

## Matchmaking

### Finding Matches

```javascript
// Find a match based on preferences
const findMatch = (socket, criteria = {}) => {
  return new Promise((resolve) => {
    socket.emit('match:find', criteria);
    
    // Listen for match found event
    socket.once('match:found', (data) => {
      resolve(data.match);
    });
    
    // Handle no matches found
    socket.once('match:notFound', () => {
      resolve(null);
    });
  });
};

// Cancel ongoing matchmaking
const cancelMatchmaking = (socket) => {
  socket.emit('cancelRandomMatch');
};

// Listen for match events
socket.on('match:waiting', (data) => {
  console.log('Looking for matches...', data.message);
  // Show searching UI
});

socket.on('match:timeout', () => {
  console.log('Matchmaking timed out');
  // Show timeout message
});
```

## Notification System

### REST API Integration

```javascript
// Get all notifications
const getNotifications = async (limit = 20, offset = 0) => {
  const response = await fetchWithAuth(`http://localhost:5000/api/notifications?limit=${limit}&offset=${offset}`);
  return await response.json();
};

// Mark notification as read
const markNotificationAsRead = async (notificationId) => {
  const response = await fetchWithAuth(`http://localhost:5000/api/notifications/${notificationId}/read`, {
    method: 'PUT',
  });
  return await response.json();
};

// Mark all notifications as read
const markAllNotificationsAsRead = async () => {
  const response = await fetchWithAuth('http://localhost:5000/api/notifications/read-all', {
    method: 'PUT',
  });
  return await response.json();
};

// Get unread notification count
const getUnreadCount = async () => {
  const response = await fetchWithAuth('http://localhost:5000/api/notifications/count');
  const data = await response.json();
  return data.success ? data.data.count : 0;
};
```

### Socket Integration

```javascript
// Get notifications through socket
const getSocketNotifications = (socket) => {
  return new Promise((resolve) => {
    socket.emit('notification:getAll', { limit: 20, offset: 0 }, (response) => {
      resolve(response.notifications);
    });
  });
};

// Get notification count
const getSocketNotificationCount = (socket) => {
  return new Promise((resolve) => {
    socket.emit('notification:getCount', (response) => {
      resolve(response.count);
    });
  });
};

// Mark notification as read
const markNotificationReadSocket = (socket, notificationId) => {
  socket.emit('notification:read', { notificationId });
};

// Mark all notifications as read
const markAllNotificationsReadSocket = (socket) => {
  socket.emit('notification:readAll');
};

// Listen for new notifications
socket.on('notification:new', (notification) => {
  console.log('New notification:', notification);
  // Update UI with new notification
});
```

## Achievement & Streak System

### Socket Integration

```javascript
// Get user achievements
const getUserAchievements = (socket) => {
  return new Promise((resolve) => {
    socket.emit('achievement:get', (response) => {
      resolve(response);
    });
  });
};

// Get user streaks
const getUserStreaks = (socket) => {
  return new Promise((resolve) => {
    socket.emit('streak:getAll', (response) => {
      resolve(response.streaks);
    });
  });
};

// Listen for streak updates
socket.on('conversation:streak', (streakData) => {
  console.log('Streak updated:', streakData);
  // Update UI to show streak information
});
```

### REST API Integration

```javascript
// Get user achievements
const getAchievements = async () => {
  const response = await fetchWithAuth('http://localhost:5000/api/achievements');
  return await response.json();
};

// Get leaderboard
const getLeaderboard = async (limit = 10, offset = 0) => {
  const response = await fetchWithAuth(`http://localhost:5000/api/achievements/leaderboard?limit=${limit}&offset=${offset}`);
  return await response.json();
};

// Get user active streaks
const getActiveStreaks = async () => {
  const response = await fetchWithAuth('http://localhost:5000/api/achievements/streaks');
  return await response.json();
};
```

## AI-Powered Features

### Setup Requirements

1. Ensure you have a Google Gemini API key in your `.env` file:
   ```
   GEMINI_API_KEY=your_google_api_key
   ```

2. Include the following dependency in your frontend package.json:
   ```json
   {
     "dependencies": {
       "@google/generative-ai": "^0.2.1"
     }
   }
   ```

### Message Suggestions

The AI Chat Copilot feature suggests contextual message replies based on conversation history and user interests.

```javascript
// Get AI message suggestions
const getMessageSuggestions = (socket, conversationId) => {
  return new Promise((resolve, reject) => {
    socket.emit('ai:messageSuggestions', { conversationId }, (response) => {
      if (response.success) {
        resolve(response.suggestions);
      } else {
        reject(new Error(response.error?.message || 'Failed to get suggestions'));
      }
    });
  });
};

// Example UI implementation
const MessageComposer = ({ conversationId, socket }) => {
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  
  // Get suggestions when conversation changes
  useEffect(() => {
    getMessageSuggestions(socket, conversationId)
      .then(setSuggestions)
      .catch(console.error);
  }, [conversationId]);
  
  // Render suggestion chips
  return (
    <div>
      {suggestions.map((suggestion, index) => (
        <button 
          key={index}
          onClick={() => setMessage(suggestion)}
          className="suggestion-chip"
        >
          {suggestion}
        </button>
      ))}
      
      <textarea 
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      
      <button onClick={() => sendMessage(socket, conversationId, message)}>
        Send
      </button>
    </div>
  );
};
```

### Profile Bio Generation

AI can generate personalized profile bios based on user interests and information.

```javascript
// Generate AI profile bio
const generateProfileBio = (socket) => {
  return new Promise((resolve, reject) => {
    socket.emit('ai:generateBio', {}, (response) => {
      if (response.success) {
        resolve(response.bio);
      } else {
        reject(new Error(response.error?.message || 'Failed to generate bio'));
      }
    });
  });
};

// Example UI implementation
const ProfileEditor = ({ socket }) => {
  const [bio, setBio] = useState('');
  
  const handleGenerateBio = async () => {
    try {
      const generatedBio = await generateProfileBio(socket);
      setBio(generatedBio);
    } catch (error) {
      console.error('Error generating bio:', error);
    }
  };
  
  return (
    <div>
      <textarea 
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder="Write something about yourself..."
      />
      
      <button onClick={handleGenerateBio}>
        Generate Bio with AI
      </button>
    </div>
  );
};
```

### Smart Icebreakers

Generate personalized icebreaker questions for matches based on mutual interests.

```javascript
// Generate icebreakers for a match
const generateIcebreakers = (socket, matchId) => {
  return new Promise((resolve, reject) => {
    socket.emit('ai:generateIcebreakers', { matchId }, (response) => {
      if (response.success) {
        resolve(response.icebreakers);
      } else {
        reject(new Error(response.error?.message || 'Failed to generate icebreakers'));
      }
    });
  });
};

// Example UI implementation
const MatchChat = ({ match, socket }) => {
  const [icebreakers, setIcebreakers] = useState([]);
  
  useEffect(() => {
    generateIcebreakers(socket, match.id)
      .then(setIcebreakers)
      .catch(console.error);
  }, [match.id]);
  
  const sendIcebreaker = (icebreaker) => {
    sendMessage(socket, match.user.id, icebreaker);
  };
  
  return (
    <div>
      <h3>Starting the Conversation</h3>
      <div className="icebreakers">
        {icebreakers.map((icebreaker, index) => (
          <div key={index} className="icebreaker-card">
            <p>{icebreaker}</p>
            <button onClick={() => sendIcebreaker(icebreaker)}>
              Send
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Conversation Mood Detection

AI analyzes conversation history to detect the emotional tone of interactions.

```javascript
// Detect mood of conversation
const detectConversationMood = (socket, conversationId) => {
  return new Promise((resolve, reject) => {
    socket.emit('ai:detectMood', { conversationId }, (response) => {
      if (response.success) {
        resolve({
          mood: response.mood,
          confidence: response.confidence
        });
      } else {
        reject(new Error(response.error?.message || 'Failed to detect mood'));
      }
    });
  });
};

// Example UI implementation
const ChatHeader = ({ conversationId, socket }) => {
  const [mood, setMood] = useState('neutral');
  const [confidence, setConfidence] = useState(0);
  
  // Refresh mood every 2 minutes if conversation is active
  useEffect(() => {
    const detectMood = async () => {
      try {
        const moodData = await detectConversationMood(socket, conversationId);
        setMood(moodData.mood);
        setConfidence(moodData.confidence);
      } catch (error) {
        console.error('Error detecting mood:', error);
      }
    };
    
    detectMood();
    const interval = setInterval(detectMood, 2 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [conversationId]);
  
  const getMoodEmoji = (mood) => {
    const emojis = {
      happy: '😊',
      excited: '😃',
      neutral: '😐',
      bored: '😒',
      sad: '😔',
      anxious: '😰',
      romantic: '😍',
      friendly: '🙂',
      tense: '😬',
      confused: '🤔'
    };
    
    return emojis[mood] || '😐';
  };
  
  return (
    <div className="chat-header">
      <h2>Conversation with {otherUser.name}</h2>
      {confidence > 30 && (
        <div className="mood-indicator" title={`Conversation mood: ${mood}`}>
          {getMoodEmoji(mood)}
        </div>
      )}
    </div>
  );
};
```

### Technical Implementation Notes

1. **Graceful Degradation**: All AI features have fallbacks if the API is unavailable or the API key is missing:
   ```javascript
   // In your frontend error handling
   if (error.message === 'Failed to generate suggestions') {
     // Use fallback suggestions
     setSuggestions([
       "How's your day going?",
       "What do you like to do for fun?",
       "Any exciting plans coming up?"
     ]);
   }
   ```

2. **Rate Limiting**: To prevent excessive API calls, implement a throttling mechanism:
   ```javascript
   // Example debouncing for mood detection
   import { debounce } from 'lodash';

   // Create debounced function
   const debouncedMoodDetection = debounce(async (conversationId) => {
     try {
       const moodData = await detectConversationMood(socket, conversationId);
       setMood(moodData.mood);
       setConfidence(moodData.confidence);
     } catch (error) {
       console.error('Error detecting mood:', error);
     }
   }, 10000); // Only call once every 10 seconds maximum

   // Call the debounced function
   useEffect(() => {
     if (conversationId) {
       debouncedMoodDetection(conversationId);
     }

     return () => {
       debouncedMoodDetection.cancel();
     };
   }, [conversationId, messages]);
   ```

3. **Conversation Analytics**: Mood detection results are stored in the `conversation_analytics` table, enabling historical analysis of conversation sentiment over time.

4. **Model Customization**: The AI features use Google's Gemini 1.5 Pro model, which offers high-quality contextual understanding while maintaining reasonable response times.

## Profile Management

### Updating Profile

```javascript
// Update user profile
const updateProfile = async (profileData) => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profileData),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Profile update error:', error);
    throw error;
  }
};

// Upload profile picture
const uploadProfilePicture = async (file) => {
  try {
    const formData = new FormData();
    formData.append('profilePicture', file);
    
    const response = await fetchWithAuth('http://localhost:5000/api/profile/picture', {
      method: 'POST',
      body: formData,
    });
    
    return await response.json();
  } catch (error) {
    console.error('Profile picture upload error:', error);
    throw error;
  }
};
```

### Managing Interests

```javascript
// Get all available interests
const getInterests = async () => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/interests');
    const data = await response.json();
    return data.success ? data.data.interests : [];
  } catch (error) {
    console.error('Error fetching interests:', error);
    return [];
  }
};

// Update user interests
const updateInterests = async (interests) => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/profile/interests', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ interests }),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error updating interests:', error);
    throw error;
  }
};
```

## Verified Profiles

Verified profiles allow users to get their identity verified, showing a badge on their profile to build trust in the community.

### Setting Up Verification

#### Request Verification

```javascript
// Request profile verification
const requestVerification = async () => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/verification/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const data = await response.json();
    
    return data;
  } catch (error) {
    console.error('Error requesting verification:', error);
    throw error;
  }
};
```

#### Submit Verification

```javascript
// Submit verification data
const submitVerification = async (verificationId, verificationType, verificationData) => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/verification/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        verification_id: verificationId,
        verificationType,
        verificationData
      }),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error submitting verification:', error);
    throw error;
  }
};

// Example usage for different verification types
const submitIdVerification = async (verificationId, idNumber, idType) => {
  return await submitVerification(
    verificationId,
    'id_document',
    {
      idNumber,
      idType, // e.g., "passport", "driver_license", "national_id"
      verifiedFields: ["name", "age"]
    }
  );
};

const submitSocialVerification = async (verificationId, socialProfiles) => {
  return await submitVerification(
    verificationId,
    'social_account',
    {
      profiles: socialProfiles // Array of linked social profiles
    }
  );
};
```

#### Check Verification Status

```javascript
// Check verification status
const checkVerificationStatus = async () => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/verification/status');
    return await response.json();
  } catch (error) {
    console.error('Error checking verification status:', error);
    throw error;
  }
};
```

### UI Components

#### Verification Badge Component

```javascript
// React component for showing verification badge
const VerificationBadge = ({ isVerified }) => {
  if (!isVerified) return null;
  
  return (
    <div className="verification-badge" title="Verified Profile">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L10.163 5.745L15 6.43L11.5 9.786L12.326 14.5L8 12.25L3.674 14.5L4.5 9.786L1 6.43L5.837 5.745L8 1.5Z" 
          fill="#4285F4" stroke="#FFFFFF" strokeWidth="1" />
      </svg>
    </div>
  );
};

// Usage in profile component
const UserProfile = ({ user }) => {
  return (
    <div className="user-profile">
      <div className="profile-header">
        <h2>{user.firstName} {user.lastName}</h2>
        <VerificationBadge isVerified={user.isVerified} />
      </div>
      {/* Rest of profile content */}
    </div>
  );
};
```

#### Verification Flow UI

```javascript
// React component for verification process
const VerificationProcess = () => {
  const [status, setStatus] = useState('none'); // 'none', 'pending', 'submitted', 'approved', 'rejected'
  const [verificationId, setVerificationId] = useState(null);
  const [step, setStep] = useState(1); // 1: Select method, 2: Submit documents, 3: Confirmation
  const [verificationType, setVerificationType] = useState('id_document');
  const [verificationData, setVerificationData] = useState({});
  
  useEffect(() => {
    // Check existing verification status on component mount
    checkVerificationStatus()
      .then(response => {
        if (response.success) {
          setStatus(response.data.status);
          if (response.data.verification_id) {
            setVerificationId(response.data.verification_id);
          }
        }
      })
      .catch(console.error);
  }, []);
  
  const handleRequest = async () => {
    try {
      const response = await requestVerification();
      
      if (response.success) {
        setVerificationId(response.data.verification_id);
        setStatus('pending');
        setStep(2);
      }
    } catch (error) {
      console.error('Error requesting verification:', error);
    }
  };
  
  const handleSubmit = async () => {
    try {
      const response = await submitVerification(
        verificationId,
        verificationType,
        verificationData
      );
      
      if (response.success) {
        setStatus('submitted');
        setStep(3);
      }
    } catch (error) {
      console.error('Error submitting verification:', error);
    }
  };
  
  // Render verification UI based on current step and status
  if (status === 'approved') {
    return (
      <div className="verification-container">
        <div className="verification-success">
          <h2>Account Verified!</h2>
          <p>Your profile now has a verified badge that is visible to other users.</p>
        </div>
      </div>
    );
  }
  
  if (status === 'submitted') {
    return (
      <div className="verification-container">
        <div className="verification-pending">
          <h2>Verification In Progress</h2>
          <p>We're reviewing your verification submission. This typically takes 1-3 business days.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="verification-container">
      {step === 1 && (
        <div className="verification-step">
          <h2>Verify Your Profile</h2>
          <p>Get a verified badge on your profile to build trust with other users.</p>
          <button onClick={handleRequest} className="primary-button">
            Start Verification
          </button>
        </div>
      )}
      
      {step === 2 && (
        <div className="verification-step">
          <h2>Submit Verification</h2>
          <div className="verification-options">
            <div className="option-selector">
              <label>
                <input 
                  type="radio" 
                  value="id_document" 
                  checked={verificationType === 'id_document'}
                  onChange={() => setVerificationType('id_document')}
                />
                Verify with ID Document
              </label>
              <label>
                <input 
                  type="radio" 
                  value="social_account" 
                  checked={verificationType === 'social_account'}
                  onChange={() => setVerificationType('social_account')}
                />
                Verify with Social Media
              </label>
            </div>
            
            {verificationType === 'id_document' && (
              <div className="id-verification-form">
                <select
                  value={verificationData.idType || ''}
                  onChange={(e) => setVerificationData({
                    ...verificationData,
                    idType: e.target.value
                  })}
                >
                  <option value="">Select ID Type</option>
                  <option value="passport">Passport</option>
                  <option value="driver_license">Driver's License</option>
                  <option value="national_id">National ID</option>
                </select>
                
                <input
                  type="text"
                  placeholder="ID Number"
                  value={verificationData.idNumber || ''}
                  onChange={(e) => setVerificationData({
                    ...verificationData,
                    idNumber: e.target.value
                  })}
                />
              </div>
            )}
            
            {verificationType === 'social_account' && (
              <div className="social-verification-form">
                <p>Link your social media accounts:</p>
                <button className="social-button">
                  Connect Instagram
                </button>
                <button className="social-button">
                  Connect Twitter
                </button>
              </div>
            )}
            
            <button
              onClick={handleSubmit}
              disabled={!verificationData.idType && verificationType === 'id_document'}
              className="primary-button"
            >
              Submit Verification
            </button>
          </div>
        </div>
      )}
      
      {step === 3 && (
        <div className="verification-step">
          <h2>Verification Submitted</h2>
          <p>Thank you for submitting your verification. We'll review your information and update your profile status shortly.</p>
        </div>
      )}
    </div>
  );
};
```

## Voice Bio

Voice bio allows users to record and upload a short audio clip to give potential matches a better sense of their personality.

### Recording and Managing Voice Bios

#### Upload Voice Bio

```javascript
// Upload voice bio recording
const uploadVoiceBio = async (audioBlob) => {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'voice_bio.mp3');
    
    const response = await fetchWithAuth('http://localhost:5000/api/profile/voice-bio', {
      method: 'POST',
      body: formData,
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error uploading voice bio:', error);
    throw error;
  }
};
```

#### Delete Voice Bio

```javascript
// Delete voice bio
const deleteVoiceBio = async () => {
  try {
    const response = await fetchWithAuth('http://localhost:5000/api/profile/voice-bio', {
      method: 'DELETE',
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error deleting voice bio:', error);
    throw error;
  }
};
```

#### Get Voice Bio

```javascript
// Get user voice bio
const getVoiceBio = async (userId) => {
  try {
    const response = await fetchWithAuth(`http://localhost:5000/api/profile/voice-bio/${userId}`);
    const data = await response.json();
    
    return data.success ? data.data.url : null;
  } catch (error) {
    console.error('Error fetching voice bio:', error);
    return null;
  }
};
```

### UI Components

#### Voice Bio Recorder Component

```javascript
// React component for recording and uploading voice bio
const VoiceBioRecorder = () => {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [countdown, setCountdown] = useState(30); // 30 seconds max
  const [uploading, setUploading] = useState(false);
  const [hasVoiceBio, setHasVoiceBio] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  
  useEffect(() => {
    // Check if user already has a voice bio
    const checkVoiceBio = async () => {
      try {
        const response = await fetchWithAuth('/api/profile');
        if (response.success && response.data.profile.voice_bio_url) {
          setHasVoiceBio(true);
          setAudioUrl(response.data.profile.voice_bio_url);
        }
      } catch (error) {
        console.error('Error checking voice bio:', error);
      }
    };
    
    checkVoiceBio();
  }, []);
  
  useEffect(() => {
    let interval;
    
    if (recording && countdown > 0) {
      interval = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0 && recording) {
      stopRecording();
    }
    
    return () => clearInterval(interval);
  }, [recording, countdown]);
  
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      mediaRecorderRef.current.addEventListener('dataavailable', (e) => {
        chunksRef.current.push(e.data);
      });
      
      mediaRecorderRef.current.addEventListener('stop', () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/mp3' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        setAudioBlob(audioBlob);
        setAudioUrl(audioUrl);
        chunksRef.current = [];
        
        // Stop all tracks on the stream
        stream.getTracks().forEach(track => track.stop());
      });
      
      mediaRecorderRef.current.start();
      setRecording(true);
      setCountdown(30);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };
  
  const handleUpload = async () => {
    if (!audioBlob) return;
    
    setUploading(true);
    try {
      const response = await uploadVoiceBio(audioBlob);
      
      if (response.success) {
        setHasVoiceBio(true);
        setAudioUrl(response.data.url);
      }
    } catch (error) {
      console.error('Error uploading voice bio:', error);
    } finally {
      setUploading(false);
    }
  };
  
  const handleDelete = async () => {
    try {
      const response = await deleteVoiceBio();
      
      if (response.success) {
        setHasVoiceBio(false);
        setAudioUrl('');
        setAudioBlob(null);
      }
    } catch (error) {
      console.error('Error deleting voice bio:', error);
    }
  };
  
  return (
    <div className="voice-bio-recorder">
      <h3>Voice Bio</h3>
      <p>Record a short introduction (max 30 seconds) for potential matches to hear.</p>
      
      {hasVoiceBio && (
        <div className="voice-bio-player">
          <audio src={audioUrl} controls />
          <button 
            onClick={handleDelete} 
            className="delete-button"
          >
            Delete Voice Bio
          </button>
        </div>
      )}
      
      {!hasVoiceBio && (
        <div className="voice-recorder">
          {!audioBlob ? (
            <div className="recording-controls">
              {recording ? (
                <div className="recording-active">
                  <div className="recording-indicator">Recording... {countdown}s</div>
                  <button 
                    onClick={stopRecording}
                    className="stop-button"
                  >
                    Stop Recording
                  </button>
                </div>
              ) : (
                <button 
                  onClick={startRecording}
                  className="record-button"
                >
                  Start Recording
                </button>
              )}
            </div>
          ) : (
            <div className="recording-preview">
              <audio src={audioUrl} controls />
              <div className="recording-actions">
                <button 
                  onClick={() => {
                    setAudioBlob(null);
                    setAudioUrl('');
                  }}
                  className="secondary-button"
                >
                  Discard
                </button>
                <button 
                  onClick={handleUpload}
                  disabled={uploading}
                  className="primary-button"
                >
                  {uploading ? 'Uploading...' : 'Save Voice Bio'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

#### Voice Bio Player Component

```javascript
// React component for playing voice bios in profile view
const VoiceBioPlayer = ({ userId }) => {
  const [audioUrl, setAudioUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  
  useEffect(() => {
    const fetchVoiceBio = async () => {
      try {
        setLoading(true);
        const url = await getVoiceBio(userId);
        setAudioUrl(url);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching voice bio:', error);
        setError(true);
        setLoading(false);
      }
    };
    
    fetchVoiceBio();
  }, [userId]);
  
  if (loading) {
    return (
      <div className="voice-bio-player loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }
  
  if (error || !audioUrl) {
    return null; // Don't show anything if there's an error or no voice bio
  }
  
  return (
    <div className="voice-bio-player">
      <h4>Voice Introduction</h4>
      <audio src={audioUrl} controls />
    </div>
  );
};
```

## Admin Features

### Admin Authentication

```javascript
// Admin login
const adminLogin = async (credentials) => {
  try {
    const response = await fetch('http://localhost:5000/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Store admin token separately from user token
      localStorage.setItem('adminToken', data.token);
    }
    
    return data;
  } catch (error) {
    console.error('Admin login error:', error);
    throw error;
  }
};

// Fetch API with admin token
const fetchWithAdminAuth = async (url, options = {}) => {
  const token = localStorage.getItem('adminToken');
  
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };
  
  return fetch(url, {
    ...options,
    headers,
  });
};
```

### User Management

```javascript
// Get all users (paginated)
const getUsers = async (page = 1, limit = 20) => {
  try {
    const response = await fetchWithAdminAuth(`http://localhost:5000/api/admin/users?page=${page}&limit=${limit}`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

// Update user status (suspend/activate)
const updateUserStatus = async (userId, isActive) => {
  try {
    const response = await fetchWithAdminAuth(`http://localhost:5000/api/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isActive }),
    });
    
    return await response.json();
  } catch (error) {
    console.error('Error updating user status:', error);
    throw error;
  }
};
```

### Analytics Dashboard

```javascript
// Get user activity analytics
const getUserAnalytics = async (startDate, endDate) => {
  try {
    const response = await fetchWithAdminAuth(
      `http://localhost:5000/api/admin/analytics/users?start=${startDate}&end=${endDate}`
    );
    return await response.json();
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    throw error;
  }
};

// Get message analytics
const getMessageAnalytics = async (startDate, endDate) => {
  try {
    const response = await fetchWithAdminAuth(
      `http://localhost:5000/api/admin/analytics/messages?start=${startDate}&end=${endDate}`
    );
    return await response.json();
  } catch (error) {
    console.error('Error fetching message analytics:', error);
    throw error;
  }
};
```

## Best Practices

### Error Handling

```javascript
// Global error handler for API calls
const apiCall = async (url, options = {}) => {
  try {
    const response = await fetchWithAuth(url, options);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'API request failed');
    }
    
    return data;
  } catch (error) {
    console.error(`API Error (${url}):`, error.message);
    
    // Handle token expiration
    if (error.message.includes('token') || error.message.includes('unauthorized')) {
      // Clear token and redirect to login
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    
    throw error;
  }
};

// Socket error handling
socket.on('error', (errorData) => {
  console.error(`Socket Error (${errorData.source || 'unknown'}):`, errorData.message);
  
  // Handle authentication errors
  if (errorData.message.includes('token') || errorData.message.includes('Authentication')) {
    localStorage.removeItem('authToken');
    window.location.href = '/login';
  }
  
  // Display error to user if needed
  if (errorData.source !== 'internal') {
    // Show toast or notification
  }
});
```

### Connection Management

```javascript
// Monitor connection health
let connectionHealthMonitor;
const startConnectionMonitor = (socket) => {
  if (connectionHealthMonitor) {
    clearInterval(connectionHealthMonitor);
  }
  
  let missedHeartbeats = 0;
  const MAX_MISSED_HEARTBEATS = 3;
  
  connectionHealthMonitor = setInterval(() => {
    if (socket.connected) {
      socket.emit('ping:check', { time: Date.now() }, (response) => {
        if (response) {
          missedHeartbeats = 0;
          console.log('Connection healthy');
        } else {
          missedHeartbeats++;
          console.warn(`Missed heartbeat (${missedHeartbeats}/${MAX_MISSED_HEARTBEATS})`);
        }
      });
      
      // If missing too many heartbeats, attempt reconnection
      if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        console.warn('Too many missed heartbeats, reconnecting...');
        socket.disconnect();
        socket.connect();
        missedHeartbeats = 0;
      }
    }
  }, 30000); // Check every 30 seconds
  
  return connectionHealthMonitor;
};

// Clean up on disconnect
const cleanup = () => {
  if (connectionHealthMonitor) {
    clearInterval(connectionHealthMonitor);
  }
};
```

---

This document will be updated as new features are implemented or existing features are modified. 