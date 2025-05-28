-- Add social media fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS instagram_handle TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS twitter_handle TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS spotify_handle TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS linkedin_handle TEXT DEFAULT NULL;

-- Create index on social media handles to improve lookup performance
CREATE INDEX IF NOT EXISTS idx_users_instagram_handle ON users (instagram_handle);
CREATE INDEX IF NOT EXISTS idx_users_twitter_handle ON users (twitter_handle); 