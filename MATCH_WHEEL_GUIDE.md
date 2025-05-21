# Daily Match Wheel - UniversalCircle

The Daily Match Wheel is a gamified feature that allows users to spin a virtual wheel once per day for a chance to win various rewards. This feature adds an element of excitement and engagement, encouraging users to return daily.

## Feature Overview

- Users can spin the wheel once every 24 hours
- Each spin rewards users with special perks, boosts, or Circle Coins
- Rewards vary in rarity and value, with weighted probabilities
- Rewards may have expiration dates, encouraging timely use
- Users receive notifications reminding them to spin if they haven't done so

## Database Structure

The Daily Match Wheel system consists of three main tables:

### wheel_rewards
- `id`: UUID (Primary Key)
- `name`: VARCHAR(100) (Name of the reward)
- `type`: VARCHAR(50) (Type of reward, e.g. "super_like", "profile_boost")
- `description`: TEXT (Description of what the reward does)
- `value`: JSONB (Additional attributes specific to the reward type)
- `probability`: INTEGER (Weight for random selection)
- `enabled`: BOOLEAN (Whether the reward is active)
- `created_at`: TIMESTAMP WITH TIME ZONE

### user_wheel_spins
- `id`: UUID (Primary Key)
- `user_id`: UUID (Reference to users)
- `last_spin_at`: TIMESTAMP WITH TIME ZONE (When user last spun the wheel)
- `next_available_spin_at`: TIMESTAMP WITH TIME ZONE (When user can spin again)
- `total_spins`: INTEGER (Total number of times the user has spun)
- `created_at`: TIMESTAMP WITH TIME ZONE

### user_rewards
- `id`: UUID (Primary Key)
- `user_id`: UUID (Reference to users)
- `reward_id`: UUID (Reference to wheel_rewards)
- `claimed`: BOOLEAN (Whether the reward has been used)
- `expires_at`: TIMESTAMP WITH TIME ZONE (When the reward expires)
- `claimed_at`: TIMESTAMP WITH TIME ZONE (When the reward was claimed)
- `created_at`: TIMESTAMP WITH TIME ZONE

## Default Rewards

The wheel includes the following default rewards:

1. **Super Like** (20% probability)
   - Highlighted like notification to another user
   - Expires after 30 days

2. **Profile Boost** (10% probability)
   - 50% visibility boost for 24 hours
   - Expires after 24 hours

3. **Conversation Starter** (25% probability)
   - AI-generated icebreaker for starting conversations
   - Expires after 30 days

4. **Circle Coins** (15% probability)
   - 50 Circle Coins added to user balance
   - Never expires

5. **Big Coin Reward** (5% probability)
   - 100 Circle Coins added to user balance
   - Never expires

6. **Match Peek** (10% probability)
   - See one potential match before they see you
   - Expires after 30 days

7. **Extra Daily Matches** (8% probability)
   - 5 additional daily matches
   - Expires after 30 days

8. **Custom Message Theme** (7% probability)
   - Special message bubble theme for 24 hours
   - Expires after 24 hours

## Implementation Details

### Key Service Methods

#### Wheel Service (src/services/wheelService.js)

- `checkSpinAvailability(userId)` - Checks if a user can spin the wheel
- `spinWheel(userId)` - Spins the wheel and awards a random reward
- `getUserRewards(userId)` - Gets all active rewards for a user
- `claimReward(userId, rewardId)` - Claims a specific reward
- `getWheelRewards()` - Gets all available wheel rewards
- `cleanupExpiredRewards()` - Updates expired rewards

### API Endpoints

#### User Routes
- `GET /api/wheel/availability` - Check if user can spin the wheel today
- `POST /api/wheel/spin` - Spin the wheel and get a reward
- `GET /api/wheel/rewards` - Get user's active rewards
- `POST /api/wheel/rewards/:rewardId/claim` - Claim a specific reward
- `GET /api/wheel/options` - Get all available wheel reward types

#### Admin Routes
- `POST /api/wheel/admin/cleanup` - Clean up expired rewards manually

### Scheduled Jobs

The system includes scheduled jobs for:

1. **Reward Cleanup** - Runs daily at 3 AM to mark expired rewards as claimed
2. **Wheel Reminders** - Sends notifications at 8 PM to users who haven't spun the wheel that day

## Frontend Integration

### Wheel Animation

The backend provides a `wheelPosition` value with each spin result, which can be used to animate the wheel on the frontend:

```javascript
// Example of wheel animation with result
const spinWheel = async () => {
  try {
    const response = await api.post('/api/wheel/spin');
    
    if (response.data.success) {
      const { reward, wheelPosition } = response.data.data;
      
      // Animate wheel to the position (0-360 degrees)
      animateWheelTo(wheelPosition);
      
      // Show reward after animation completes
      setTimeout(() => {
        displayReward(reward);
      }, 3000);
    } else {
      // Handle error - usually "can't spin yet"
      showTimeRemaining(response.data.timeRemaining);
    }
  } catch (error) {
    console.error('Error spinning wheel:', error);
  }
};
```

### Reward Display

Rewards can be shown in the user's profile or a dedicated rewards section:

```javascript
// Example of displaying rewards
const showMyRewards = async () => {
  try {
    const response = await api.get('/api/wheel/rewards');
    
    if (response.data.success) {
      const rewards = response.data.data;
      
      // Group rewards by type
      const groupedRewards = rewards.reduce((acc, reward) => {
        const type = reward.reward.type;
        if (!acc[type]) acc[type] = [];
        acc[type].push(reward);
        return acc;
      }, {});
      
      // Display rewards by group
      displayRewardsInUI(groupedRewards);
    }
  } catch (error) {
    console.error('Error getting rewards:', error);
  }
};
```

## Reward Application Process

### Profile Boost
When a user claims a profile boost reward, their profile is given higher priority in match suggestions for the specified duration.

### Super Like
Super likes highlight the user's profile to the recipient when they like someone. This increases the chance of matching.

### Circle Coins
Circle Coins are automatically added to the user's balance when claimed. They can be used for premium features.

### Match Peek
Users can see profiles that might be interested in them before those users see their profile.

### Extra Matches
Users get additional daily matches beyond the standard limit.

## Security Considerations

- Row Level Security (RLS) policies ensure users can only access their own wheel data
- Server-side validation prevents users from spinning the wheel more than once every 24 hours
- Probabilities are handled server-side to prevent manipulation
- Reward claims are validated to ensure legitimacy

## Future Enhancements

1. **Streak Bonuses**
   - Increase reward probabilities or values for users who spin multiple days in a row

2. **Special Event Wheels**
   - Create themed wheels for holidays or special events with unique rewards

3. **Reward Gifting**
   - Allow users to gift certain rewards to friends

4. **Premium Wheel**
   - Create a premium wheel with better rewards, accessible with Circle Coins

5. **Jackpot System**
   - Accumulate a jackpot that randomly drops for lucky users

## Conclusion

The Daily Match Wheel creates an engaging daily ritual that encourages users to return to the app regularly. By offering varied rewards with different utilities, it adds an element of surprise and delight to the user experience while reinforcing the app's core matching and engagement features. 