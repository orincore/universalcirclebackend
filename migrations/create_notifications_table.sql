-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    is_silent BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_type_idx ON notifications(type);
CREATE INDEX IF NOT EXISTS notifications_is_read_idx ON notifications(is_read);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at DESC);

-- Create function for conversations with no activity in a given threshold
CREATE OR REPLACE FUNCTION get_inactive_conversations(inactivity_threshold TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
    id UUID,
    user1_id UUID,
    user1_name TEXT,
    user1_photo TEXT,
    user2_id UUID,
    user2_name TEXT,
    user2_photo TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    WITH latest_messages AS (
        SELECT
            CASE 
                WHEN m.sender_id < m.receiver_id THEN m.sender_id || '_' || m.receiver_id
                ELSE m.receiver_id || '_' || m.sender_id
            END AS conversation_id,
            MAX(m.created_at) AS last_message_time
        FROM
            messages m
        GROUP BY
            conversation_id
    ),
    conversation_pairs AS (
        SELECT
            m.sender_id AS user1_id,
            m.receiver_id AS user2_id,
            lm.last_message_time
        FROM
            messages m
        JOIN
            latest_messages lm ON 
            CASE 
                WHEN m.sender_id < m.receiver_id THEN m.sender_id || '_' || m.receiver_id
                ELSE m.receiver_id || '_' || m.sender_id
            END = lm.conversation_id
        WHERE
            lm.last_message_time < inactivity_threshold
        GROUP BY
            m.sender_id, m.receiver_id, lm.last_message_time
    )
    SELECT
        gen_random_uuid() AS id,
        cp.user1_id,
        u1.username AS user1_name,
        u1.profile_picture_url AS user1_photo,
        cp.user2_id,
        u2.username AS user2_name,
        u2.profile_picture_url AS user2_photo,
        cp.last_message_time AS last_message_at
    FROM
        conversation_pairs cp
    JOIN
        users u1 ON cp.user1_id = u1.id
    JOIN
        users u2 ON cp.user2_id = u2.id;
END;
$$ LANGUAGE plpgsql;

-- Create function for expiring conversation streaks
CREATE OR REPLACE FUNCTION get_expiring_streaks(hours_lower INT, hours_upper INT)
RETURNS TABLE (
    conversation_id TEXT,
    user1_id UUID,
    user1_name TEXT,
    user2_id UUID,
    user2_name TEXT,
    current_streak INT,
    expires_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    WITH conversation_data AS (
        SELECT
            CASE 
                WHEN m.sender_id < m.receiver_id THEN m.sender_id || '_' || m.receiver_id
                ELSE m.receiver_id || '_' || m.sender_id
            END AS conversation_id,
            MAX(m.created_at) AS last_message_time,
            COUNT(*) FILTER (WHERE m.created_at > (NOW() - INTERVAL '7 days')) AS recent_message_count
        FROM
            messages m
        GROUP BY
            conversation_id
        HAVING
            COUNT(*) FILTER (WHERE m.created_at > (NOW() - INTERVAL '7 days')) >= 3
    ),
    expiring_conversations AS (
        SELECT
            cd.conversation_id,
            cd.last_message_time,
            cd.recent_message_count,
            EXTRACT(EPOCH FROM (NOW() - cd.last_message_time)) / 3600 AS hours_since_last_message
        FROM
            conversation_data cd
        WHERE
            EXTRACT(EPOCH FROM (NOW() - cd.last_message_time)) / 3600 BETWEEN hours_lower AND hours_upper
    )
    SELECT
        ec.conversation_id,
        CASE WHEN SPLIT_PART(ec.conversation_id, '_', 1)::UUID = m.sender_id
            THEN m.sender_id ELSE m.receiver_id END AS user1_id,
        CASE WHEN SPLIT_PART(ec.conversation_id, '_', 1)::UUID = m.sender_id
            THEN u1.username ELSE u2.username END AS user1_name,
        CASE WHEN SPLIT_PART(ec.conversation_id, '_', 1)::UUID = m.sender_id
            THEN m.receiver_id ELSE m.sender_id END AS user2_id,
        CASE WHEN SPLIT_PART(ec.conversation_id, '_', 1)::UUID = m.sender_id
            THEN u2.username ELSE u1.username END AS user2_name,
        FLOOR(ec.recent_message_count / 2) AS current_streak,
        ec.last_message_time + INTERVAL '1 day' AS expires_at
    FROM
        expiring_conversations ec
    JOIN
        messages m ON 
        CASE 
            WHEN m.sender_id < m.receiver_id THEN m.sender_id || '_' || m.receiver_id
            ELSE m.receiver_id || '_' || m.sender_id
        END = ec.conversation_id
    JOIN
        users u1 ON m.sender_id = u1.id
    JOIN
        users u2 ON m.receiver_id = u2.id
    GROUP BY
        ec.conversation_id, ec.recent_message_count, ec.last_message_time,
        m.sender_id, m.receiver_id, u1.username, u2.username;
END;
$$ LANGUAGE plpgsql;

-- Function to get users without matches today
CREATE OR REPLACE FUNCTION get_users_without_matches_today(today_date TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
    id UUID,
    username TEXT,
    profile_picture_url TEXT,
    gender TEXT,
    preference TEXT,
    interests TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id,
        u.username,
        u.profile_picture_url,
        u.gender,
        u.preference,
        u.interests
    FROM
        users u
    WHERE
        u.id NOT IN (
            SELECT user1_id FROM matches WHERE created_at >= today_date
            UNION
            SELECT user2_id FROM matches WHERE created_at >= today_date
        )
    AND
        u.last_online > (NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql;

-- Function to get potential matches for a user
CREATE OR REPLACE FUNCTION get_potential_matches(
    user_id UUID,
    limit_count INT DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    username TEXT,
    profile_picture_url TEXT,
    compatibility_score INT
) AS $$
DECLARE
    user_preference TEXT;
    user_gender TEXT;
    user_interests TEXT[];
BEGIN
    -- Get user information
    SELECT 
        preference, gender, interests INTO user_preference, user_gender, user_interests
    FROM 
        users
    WHERE 
        id = user_id;

    -- Return potential matches
    RETURN QUERY
    WITH potential_users AS (
        SELECT
            u.id,
            u.username,
            u.profile_picture_url,
            u.interests,
            -- Calculate compatibility score based on shared interests
            (
                SELECT COUNT(*) 
                FROM unnest(u.interests) interest
                WHERE interest = ANY(user_interests)
            ) * 10 AS raw_score
        FROM
            users u
        WHERE
            u.id != user_id
            AND u.preference = user_preference
            AND (
                (user_gender = 'male' AND u.gender = 'female')
                OR (user_gender = 'female' AND u.gender = 'male')
                OR (user_preference = 'Friendship')
            )
            -- Exclude users who are already matched with this user
            AND NOT EXISTS (
                SELECT 1 FROM matches m
                WHERE (m.user1_id = user_id AND m.user2_id = u.id)
                   OR (m.user1_id = u.id AND m.user2_id = user_id)
            )
            -- User must be active recently
            AND u.last_online > (NOW() - INTERVAL '7 days')
    )
    SELECT
        id,
        username,
        profile_picture_url,
        LEAST(GREATEST(raw_score, 10), 100) AS compatibility_score
    FROM
        potential_users
    WHERE
        raw_score > 0
    ORDER BY
        compatibility_score DESC, RANDOM()
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql; 