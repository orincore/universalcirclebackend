-- Add achievement_points column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS achievement_points INTEGER DEFAULT 0;

-- Create user achievements table
CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_type VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    points INTEGER NOT NULL DEFAULT 0,
    unlocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on user_id
CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx ON user_achievements(user_id);

-- Create index on achievement_type
CREATE INDEX IF NOT EXISTS user_achievements_type_idx ON user_achievements(achievement_type);

-- Create conversation streaks table
CREATE TABLE IF NOT EXISTS conversation_streaks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id TEXT NOT NULL UNIQUE,
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    streak_days INTEGER NOT NULL DEFAULT 1,
    last_message_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on conversation_id
CREATE INDEX IF NOT EXISTS conversation_streaks_conversation_id_idx ON conversation_streaks(conversation_id);

-- Create indexes on user IDs
CREATE INDEX IF NOT EXISTS conversation_streaks_user1_id_idx ON conversation_streaks(user1_id);
CREATE INDEX IF NOT EXISTS conversation_streaks_user2_id_idx ON conversation_streaks(user2_id);

-- Create index on expires_at
CREATE INDEX IF NOT EXISTS conversation_streaks_expires_at_idx ON conversation_streaks(expires_at);

-- Create function to get match count for a user
CREATE OR REPLACE FUNCTION get_match_count(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    match_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO match_count
    FROM matches
    WHERE (user1_id = user_id OR user2_id = user_id)
    AND status = 'accepted';
    
    RETURN match_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to get conversation partners count
CREATE OR REPLACE FUNCTION get_conversation_partners_count(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    partners_count INTEGER;
BEGIN
    WITH conversation_partners AS (
        -- Get all unique users this user has exchanged messages with
        SELECT DISTINCT
            CASE WHEN sender_id = user_id THEN receiver_id
                 ELSE sender_id
            END AS partner_id
        FROM messages
        WHERE sender_id = user_id OR receiver_id = user_id
    )
    SELECT COUNT(*) INTO partners_count
    FROM conversation_partners;
    
    RETURN partners_count;
END;
$$ LANGUAGE plpgsql; 