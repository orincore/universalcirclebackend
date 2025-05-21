# Mini-Games API Testing Guide

This guide explains how to test the Mini-Games in Chat feature using the provided test scripts.

## Prerequisites

Before running the tests, make sure you have:

1. Node.js installed (v14+ recommended)
2. The UniversalCircle backend server running locally on port 5001 (or specified in .env file)
3. Test user accounts created in the system

## Setting Up

1. Install dependencies:
   ```bash
   cd test_scripts
   npm install
   ```

2. Configure your environment variables in a `.env` file:
   ```
   API_URL=http://localhost:5001
   TEST_USER1_EMAIL=testuser1@example.com
   TEST_USER1_PASSWORD=password123
   TEST_USER2_EMAIL=testuser2@example.com
   TEST_USER2_PASSWORD=password123
   ```

## Running Tests

### Basic API Test

This test checks the basic functionality of all Mini-Games API endpoints:

```bash
npm test
```

The test will:
1. Log in as both test users
2. Create a conversation between them
3. Test getting available games
4. Create a new game instance (Emoji Guess)
5. Accept the game invitation
6. Make moves in the game

### Comprehensive Game Type Test

This test runs through every game type available in the system:

```bash
npm run test:all-games
```

The test will:
1. Log in as both test users
2. Create a conversation between them
3. Test each available game type by:
   - Creating a new game
   - Accepting the invitation
   - Making moves specific to that game type
   - Getting the final game state

### Real-time Game Message Monitor

This tool lets you monitor game messages in a conversation in real-time:

```bash
npm run monitor [conversation_id]
```

The monitor will:
1. Log in as the first test user
2. Connect to the socket.io server
3. Retrieve history of game-related messages in the conversation
4. Display any new game messages, invitations, or moves in real-time

## Testing Manually

You can also test the API manually using tools like Postman or curl:

### Required Headers

```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

### Example API Requests

1. Get Available Games:
   ```
   GET /api/games/available
   ```

2. Create New Game:
   ```
   POST /api/games/create
   {
     "conversationId": "CONVERSATION_ID",
     "gameType": "emoji_guess",
     "responderId": "USER_ID"
   }
   ```

3. Accept Game:
   ```
   POST /api/games/GAME_INSTANCE_ID/accept
   {}
   ```

4. Make Move (Emoji Guess):
   ```
   POST /api/games/GAME_INSTANCE_ID/move
   {
     "guess": "Running fast"
   }
   ```

## Troubleshooting

- **Authentication Errors**: Make sure your test users exist and credentials are correct
- **Connection Refused**: Verify the backend server is running on the expected port
- **Not Found Errors**: Check that the API endpoints match what's expected in the code

## Debugging Tips

1. Check the server logs for detailed error information
2. Look for specific error responses from the API calls
3. Verify the conversation and user IDs are valid UUIDs 