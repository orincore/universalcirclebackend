# Conversation Streak System - UniversalCircle

The Conversation Streak System is a feature designed to encourage consistent communication between users on the Circle platform. By maintaining daily conversations, users can build streaks that unlock special rewards, achievements, and recognition.

## Database Structure

The streak system consists of three main tables:

### conversation_streaks
- `id`: UUID (Primary Key)
- `conversation_id`: UUID (Reference to conversation)
- `user1_id`: UUID (Reference to first user)
- `user2_id`: UUID (Reference to second user)
- `current_streak`: INTEGER (Current streak count in days)
- `longest_streak`: INTEGER (Longest streak achieved)
- `last_message_at`: TIMESTAMP WITH TIMEZONE (When the last message was sent)
- `streak_expires_at`: TIMESTAMP WITH TIMEZONE (When the streak will expire)
- `created_at`: TIMESTAMP WITH TIMEZONE (When the streak record was created)
- `updated_at`: TIMESTAMP WITH TIMEZONE (When the streak record was last updated)

### streak_milestones
- `id`: UUID (Primary Key)
- `conversation_streak_id`: UUID (Reference to conversation_streaks)
- `days_count`: INTEGER (Number of days for this milestone)
- `reached_at`: TIMESTAMP WITH TIMEZONE (When the milestone was reached)
- `notified`: BOOLEAN (Whether users have been notified)
- `created_at`: TIMESTAMP WITH TIMEZONE (When the milestone was recorded)

### streak_bonuses
- `id`: UUID (Primary Key)
- `days`: INTEGER (Number of streak days required)
- `bonus_type`: VARCHAR(50) (Type of bonus, e.g., "visibility_boost", "circle_coins")
- `bonus_amount`: INTEGER (Amount of the bonus)
- `description`: TEXT (Description of the bonus)
- `created_at`: TIMESTAMP WITH TIMEZONE (When the bonus was created)

## How Streaks Work

1. **Starting a Streak**
   - A streak begins when two users exchange messages.
   - The initial streak is set to 1 day.

2. **Maintaining a Streak**
   - To maintain a streak, users must exchange at least one message within each 24-hour period.
   - The streak count increases by 1 for each consecutive day of messaging.

3. **Breaking a Streak**
   - If 24 hours pass without a message, the streak is broken.
   - The streak resets to 0 when broken.
   - The longest streak is always preserved for reference.

4. **Streak Notifications**
   - Users receive a notification when a streak is about to expire (within 4 hours of expiration).
   - Users are notified when they reach streak milestones (e.g., 3 days, 7 days, 30 days).

5. **Streak Bonuses**
   - At specific milestones (e.g., 7 days, 30 days), users receive bonuses.
   - Bonuses may include visibility boosts, Circle Coins, or other rewards.

## Implementation Details

### Core Constants
- `STREAK_RESET_HOURS`: 24 (Hours without a message before a streak resets)
- `STREAK_MILESTONE_THRESHOLDS`: [3, 7, 14, 30, 60, 90, 180, 365] (Days at which milestones are achieved)

### Key Service Methods

#### Streak Service (src/services/streakService.js)

- `updateConversationStreak(conversationId, senderId, receiverId, messageTime)` - Updates the streak when a message is sent
- `getConversationStreak(conversationId)` - Gets streak details for a specific conversation
- `getUserActiveStreaks(userId)` - Gets all active streaks for a user
- `getStreakBetweenUsers(userId1, userId2)` - Gets streak information between two specific users
- `findExpiringStreaks(hoursLower, hoursUpper)` - Finds streaks that will expire within a time range
- `getUserStreakMilestones(userId)` - Gets milestone achievements for a user
- `getRecentMilestones()` - Gets recent milestones that need notifications
- `markMilestoneNotified(milestoneId)` - Marks a milestone as notified
- `getStreakBonuses()` - Gets all available streak bonuses

### API Endpoints

#### User Routes
- `GET /api/streaks/my/active` - Get all active streaks for the current user
- `GET /api/streaks/my/milestones` - Get all streak milestones achieved by the current user
- `GET /api/streaks/with/:userId` - Get streak information with a specific user
- `GET /api/streaks/conversation/:conversationId` - Get streak information for a specific conversation
- `GET /api/streaks/bonuses` - Get all available streak bonuses

#### Admin Routes
- `GET /api/streaks/admin/expiring` - Get all streaks about to expire (for monitoring)

### Integration Points

The streak system is integrated with several parts of the application:

1. **Message Sending**
   - Streaks are automatically updated when messages are sent.
   - The message controller (`src/controllers/messageController.js`) includes streak updates.

2. **Notifications**
   - Scheduled jobs check for expiring streaks and send notifications.
   - Streak milestone notifications are sent automatically.

3. **Achievements**
   - Streak achievements are awarded at specific milestones.
   - Integrates with the Achievement system to unlock relevant badges.

## Default Streak Bonuses

The system comes with the following default bonuses:

1. **7-Day Streak**
   - 10% visibility boost for 24 hours
   - 50 Circle Coins

2. **14-Day Streak**
   - 15% visibility boost for 48 hours
   - 100 Circle Coins

3. **30-Day Streak**
   - 25% visibility boost for 72 hours
   - 250 Circle Coins
   - Special "30-Day Streak" badge

4. **90-Day Streak**
   - 50% visibility boost for 1 week
   - 500 Circle Coins
   - Special "90-Day Connection" badge

5. **365-Day Streak**
   - Permanent profile highlight
   - 2000 Circle Coins
   - Special "Circle Soulmate" badge

## Example Usage

### Checking Current Streak on Frontend
```javascript
// Get streak with another user
const getStreak = async (otherUserId) => {
  const response = await api.get(`/api/streaks/with/${otherUserId}`);
  
  if (response.data.success) {
    const { current_streak, longest_streak, streak_expires_at } = response.data.data;
    
    // Display streak information
    displayStreakInfo(current_streak, longest_streak, streak_expires_at);
  }
};
```

### Displaying Streak Notifications
```javascript
// Show streak expiring notification
const showStreakExpiringNotification = (notification) => {
  const { conversationId, currentStreak, expiresAt } = notification.metadata;
  const expirationTime = new Date(expiresAt);
  const hoursLeft = Math.floor((expirationTime - new Date()) / (60 * 60 * 1000));
  
  showNotification({
    title: notification.title,
    message: `${notification.message} Only ${hoursLeft} hours left!`,
    action: () => navigateToConversation(conversationId)
  });
};
```

## Security Considerations

- Row Level Security (RLS) policies ensure users can only access their own streak data.
- Streak updates are server-controlled to prevent manipulation.
- Edge cases like timezone differences and server downtime are handled gracefully.

## Future Enhancements

1. **Streak Recovery Items**
   - Allow users to purchase or earn items that can recover a broken streak.

2. **Streak Leaderboards**
   - Display users with the longest active streaks on a global or friend leaderboard.

3. **Streak Challenges**
   - Create time-limited challenges where users can earn special rewards for maintaining streaks.

4. **Streak Analytics**
   - Provide users with insights about their communication patterns and streak history.

5. **Custom Streak Celebrations**
   - Allow users to set custom celebration animations for specific milestones.

## Conclusion

The Conversation Streak System is designed to encourage consistent communication between users, fostering deeper connections and more engaged conversations. By gamifying regular interactions, users have an added incentive to maintain their connections, ultimately creating a more active and vibrant community on the Circle platform. 