-- Function to get active conversation count for a user
CREATE OR REPLACE FUNCTION get_active_conversation_count(
  user_id UUID,
  active_threshold TIMESTAMP WITH TIME ZONE
)
RETURNS INTEGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT
    CASE 
      WHEN m.sender_id = user_id THEN m.receiver_id
      ELSE m.sender_id
    END
  ) INTO active_count
  FROM messages m
  WHERE 
    (m.sender_id = user_id OR m.receiver_id = user_id)
    AND m.created_at > active_threshold;
    
  RETURN active_count;
END;
$$ LANGUAGE plpgsql;

-- Create mood table for storing conversation mood analysis
CREATE TABLE IF NOT EXISTS conversation_moods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id TEXT NOT NULL,
  mood VARCHAR(20) NOT NULL,
  confidence INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on conversation_id
CREATE INDEX IF NOT EXISTS conversation_moods_conversation_id_idx ON conversation_moods(conversation_id);

-- Create index on created_at
CREATE INDEX IF NOT EXISTS conversation_moods_created_at_idx ON conversation_moods(created_at); 