# UniversalCircle Achievement System

The achievement system gamifies the user experience by rewarding users for reaching milestones and engaging with the application. This document outlines the implementation details and usage of the achievement system.

## Database Structure

### Tables

#### `achievements` 
Stores all available achievements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Achievement name |
| description | TEXT | Achievement description |
| badge_icon | VARCHAR(255) | Icon identifier for the badge |
| badge_color | VARCHAR(50) | Color code for the badge |
| points | INTEGER | Points awarded for completing the achievement |
| requirement_type | VARCHAR(50) | Type of requirement (e.g., profile_completion, matches) |
| requirement_count | INTEGER | Threshold count to complete the achievement |
| category | VARCHAR(50) | Achievement category (e.g., profile, messaging, social) |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

#### `user_achievements` 
Tracks user progress toward achievements.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to users table |
| achievement_id | UUID | Foreign key to achievements table |
| earned_at | TIMESTAMP | When the achievement was earned |
| progress | INTEGER | Current progress toward the achievement |
| completed | BOOLEAN | Whether the achievement is completed |
| notified | BOOLEAN | Whether the user was notified about the achievement |

## Default Achievements

The application includes the following default achievements:

1. **Profile Perfectionist** - Complete 100% of your profile
2. **Conversation Starter** - Start your first conversation
3. **Social Butterfly** - Match with 10 other users
4. **Speed Dater** - Get 5 matches in a single day
5. **Streak Master** - Maintain a 7-day conversation streak
6. **Photo Maven** - Upload 5 profile pictures
7. **Voice Virtuoso** - Add a voice bio to your profile
8. **Verified User** - Get your profile verified
9. **Early Adopter** - Join during the app's first month
10. **Daily Logger** - Log in for 14 consecutive days

## Service Implementation

The achievement system is implemented in `src/services/achievementService.js` with the following key functions:

- **getAllAchievements()** - Gets all available achievements
- **getUserAchievements(userId)** - Gets all achievements for a user
- **checkAchievementProgress(userId, type, count)** - Checks and updates progress for a specific achievement type
- **checkProfileCompletion(userId)** - Checks profile completion percentage
- **checkVerificationAchievement(userId)** - Checks for verification achievement
- **checkVoiceBioAchievement(userId)** - Checks if user has a voice bio
- **checkMatchAchievements(userId)** - Checks match-related achievements
- **checkConversationStreak(userId, conversationId, streak)** - Checks conversation streak achievement

## API Endpoints

### Public Routes

- `GET /api/achievements` - Get all available achievements
- `GET /api/achievements/category/:category` - Get achievements by category
- `GET /api/achievements/user/:userId` - Get a user's completed achievements (for profile viewing)

### Authenticated Routes

- `GET /api/achievements/my` - Get current user's achievements
- `GET /api/achievements/my/completed` - Get current user's completed achievements
- `GET /api/achievements/my/progress` - Get current user's achievement progress
- `POST /api/achievements/my/check-profile` - Trigger profile completion check

### Admin Routes

- `POST /api/achievements/admin/check` - Manually check an achievement (admin only)

## Integration Points

The achievement system is integrated with other features in the following ways:

1. **Profile Updates** - When a user updates their profile, the system checks for profile completion achievement
2. **Voice Bio** - When a user uploads a voice bio, the system checks for the Voice Virtuoso achievement
3. **Verification** - When a user gets verified, the system checks for the Verified User achievement
4. **Login** - Login streaks can be tracked to award the Daily Logger achievement
5. **Matchmaking** - When matches are created, the system can check for Social Butterfly and Speed Dater achievements
6. **Messaging** - Conversation streaks can be monitored for the Streak Master achievement

## Security

The achievement system uses Row Level Security (RLS) to ensure:
- Anyone can view the list of available achievements
- Users can only see their own achievement progress
- Users can only see other users' completed achievements (for public profiles)
- Only admins can modify achievements and user achievement records

## Example Usage

### Checking for an achievement after a user action:

```javascript
// When user updates their profile
const completedAchievements = await achievementService.checkProfileCompletion(userId);

// If the user completed any achievements, you can notify them
if (completedAchievements.length > 0) {
  // Send notification or real-time update to the client
}
```

### Displaying a user's achievements on their profile:

```javascript
// Get user's completed achievements
const achievements = await achievementService.getUserCompletedAchievements(userId);

// Format for display
const badges = achievements.map(ach => ({
  name: ach.achievements.name,
  icon: ach.achievements.badge_icon,
  color: ach.achievements.badge_color,
  earnedAt: ach.earned_at
}));
```

## Future Enhancements

Potential enhancements for the achievement system:

1. **Achievement Tiers** - Bronze, Silver, Gold levels for each achievement
2. **Achievement Points Shop** - Allow users to spend achievement points on rewards
3. **Limited-Time Achievements** - Special achievements available during events
4. **Achievement Leaderboards** - Ranking users by achievement points
5. **Achievement Sharing** - Allow users to share achievements on social media

## Conclusion

The achievement system provides gamification to enhance user engagement and retention. By recognizing users' milestones, it creates a sense of accomplishment and encourages continued participation in the community. 