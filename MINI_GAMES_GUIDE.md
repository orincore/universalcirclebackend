# Mini-Games in Chat Guide

## Overview

Mini-Games in Chat is a feature designed to enhance user engagement within conversations by allowing users to play interactive games with their matches. This feature adds a fun, competitive element to conversations, helping users break the ice and build connections through shared experiences.

## Game Types

The system currently supports five different mini-games:

1. **Emoji Guess** - Players are presented with emoji combinations and must guess what they represent.
2. **Word Association** - Players take turns responding to words with related words, building a chain of associations.
3. **Truth or Dare** - Players choose between answering personal questions or completing fun challenges.
4. **Trivia Challenge** - Players answer multiple-choice questions across various categories and difficulty levels.
5. **Two Truths and a Lie** - Players share three statements about themselves, with one being false, and the other player guesses which is the lie.

## Database Structure

### Tables

#### `mini_games`
Stores the available game types and their configurations.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Display name of the game |
| type | TEXT | Internal game type identifier |
| description | TEXT | Brief description of the game |
| rules | JSONB | Game-specific rules and settings |
| enabled | BOOLEAN | Whether the game is available to players |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

#### `game_instances`
Tracks active and completed game sessions.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| game_id | UUID | Reference to mini_games.id |
| conversation_id | UUID | Reference to conversations.id |
| initiator_id | UUID | User who started the game |
| responder_id | UUID | User who was invited to the game |
| status | TEXT | Game status: 'pending', 'active', 'completed', 'expired' |
| state | JSONB | Current game state data |
| score | JSONB | Current score for each player |
| expires_at | TIMESTAMP | When the game will expire if inactive |
| completed_at | TIMESTAMP | When the game was completed (if applicable) |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

#### `game_moves`
Records individual moves made by players.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| game_instance_id | UUID | Reference to game_instances.id |
| user_id | UUID | User who made the move |
| move_data | JSONB | Data specific to the move |
| move_number | INTEGER | Sequential number of the move |
| created_at | TIMESTAMP | When the move was made |

## Implementation Details

### Game Lifecycle

1. **Initiation**: A user invites another user to play a specific game type.
2. **Acceptance**: The invited user accepts the game invitation.
3. **Gameplay**: Users take turns making moves according to the game's rules.
4. **Completion**: The game ends when a winning condition is met or the maximum number of rounds is reached.
5. **Rewards**: Players earn points based on their performance, which can unlock achievements.

### Key Service Methods

The `gameService.js` module provides the following core functionality:

- `getAvailableGames()` - Retrieves all enabled game types
- `createGame(gameType, conversationId, initiatorId, responderId)` - Creates a new game instance
- `acceptGame(gameInstanceId, userId)` - Accepts a game invitation
- `makeMove(gameInstanceId, userId, moveData)` - Processes a player's move
- `getActiveGamesByConversation(conversationId)` - Gets all active games in a conversation
- `getGameInstance(gameInstanceId)` - Retrieves details about a specific game

### Game State Management

Each game type has its own state structure and rules for processing moves:

- **Emoji Guess**: Players see emoji combinations and earn points for correct guesses.
- **Word Association**: Players respond to the previous word with a related word, avoiding repetition.
- **Truth or Dare**: Players alternate between choosing truth questions or dares.
- **Trivia**: Players answer questions with varying difficulty levels and point values.
- **Two Truths and a Lie**: Players submit statements and then guess which statements from their opponent are lies.

## API Endpoints

### Game Management

- `GET /api/games/available` - Get all available game types
- `GET /api/games/conversation/:conversationId` - Get active games in a conversation
- `GET /api/games/:gameInstanceId` - Get details about a specific game
- `POST /api/games/create` - Create a new game instance
- `POST /api/games/:gameInstanceId/accept` - Accept a game invitation
- `POST /api/games/:gameInstanceId/move` - Make a move in a game

## Integration with Chat

Mini-games are deeply integrated with the messaging system:

1. **Game Invitations**: When a user invites another to play, a special message appears in the chat.
2. **Game Acceptance**: When a user accepts an invitation, a confirmation message is sent.
3. **Game Moves**: Each move generates a message in the conversation with details about the action.
4. **Game Completion**: When a game ends, a summary message shows the final scores.

### Message Types

The system uses special message types to distinguish game-related messages:

- `game_invitation` - Invitation to play a game
- `game_accepted` - Acceptance of a game invitation
- `game_move` - A move made in a game
- `game_completed` - Notification that a game has finished

Each message includes metadata with game details, allowing the frontend to display appropriate UI elements.

## Achievement Integration

Playing mini-games can unlock various achievements:

- **First Mini-Game** - Complete your first mini-game
- **Mini-Game Enthusiast** - Complete 5 mini-games
- **Game Master** - Complete 20 mini-games
- **First Game Win** - Win your first mini-game
- **Winning Streak** - Win 5 mini-games
- **Game Champion** - Win 15 mini-games

## Security Considerations

- Row Level Security (RLS) ensures users can only access their own game data.
- Input validation prevents cheating or exploitation.
- Rate limiting prevents spam or abuse of game creation.
- Game expiration prevents abandoned games from lingering indefinitely.

## Frontend Implementation Guidelines

### Game UI Components

For each game type, the frontend should implement:

1. **Game Invitation Card** - Shows game details and accept/decline buttons
2. **Game Board** - The main interface for playing the game
3. **Move History** - Shows previous moves in the current game
4. **Score Display** - Shows current scores for both players
5. **Game Over Screen** - Shows final results and offers to play again

### Example: Emoji Guess UI

```javascript
function EmojiGuessGame({ gameInstance, onMakeMove }) {
  const [guess, setGuess] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(30);
  
  // Current emoji set based on round
  const currentEmoji = gameInstance.state.gameData.emojiSets[
    gameInstance.state.currentRound - 1
  ];
  
  // Handle submission
  const handleSubmit = () => {
    onMakeMove({
      guess,
      timeRemaining
    });
    setGuess('');
  };
  
  return (
    <div className="game-board emoji-guess">
      <div className="emoji-display">{currentEmoji.emojis}</div>
      <div className="timer">Time: {timeRemaining}s</div>
      <input 
        type="text" 
        value={guess} 
        onChange={(e) => setGuess(e.target.value)} 
        placeholder="What does this emoji combination mean?"
      />
      <button onClick={handleSubmit}>Submit Guess</button>
    </div>
  );
}
```

## Future Enhancements

Potential improvements to the mini-games feature:

1. **More Game Types** - Add games like Hangman, Tic-tac-toe, or Rock-Paper-Scissors
2. **Tournament Mode** - Allow users to compete in multi-round tournaments
3. **Spectator Mode** - Let friends watch ongoing games
4. **Custom Games** - Allow users to create custom game rules or content
5. **Rewards Integration** - Connect game wins to the Daily Match Wheel for bonus spins
6. **Leaderboards** - Show top players across different game types

## Conclusion

Mini-Games in Chat provides a powerful engagement mechanism that encourages users to interact in a fun, low-pressure way. By gamifying conversations, we create memorable shared experiences that strengthen connections between users and increase overall platform engagement.

The feature's integration with the messaging system ensures a seamless experience, while the achievement system provides additional motivation for continued play. As users unlock achievements and improve their skills, they develop a stronger attachment to the platform and their connections within it. 