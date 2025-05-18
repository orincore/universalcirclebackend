-- Add sequence column to messages table
ALTER TABLE IF EXISTS messages 
ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 0;

-- Add index on the sequence column for faster ordering
CREATE INDEX IF NOT EXISTS messages_sequence_idx ON messages(sequence);

-- Add index on conversation participants for faster queries
CREATE INDEX IF NOT EXISTS messages_conversation_idx 
ON messages(sender_id, receiver_id);

-- Add timestamp for when the message was delivered
ALTER TABLE IF EXISTS messages
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ; 