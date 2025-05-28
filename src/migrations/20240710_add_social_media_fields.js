const { createMigration } = require('../utils/migrationHelper');

const up = `
-- Add social media fields to users table
ALTER TABLE users 
ADD COLUMN instagram_handle TEXT DEFAULT NULL,
ADD COLUMN twitter_handle TEXT DEFAULT NULL,
ADD COLUMN spotify_handle TEXT DEFAULT NULL,
ADD COLUMN linkedin_handle TEXT DEFAULT NULL;

-- Create index on social media handles to improve lookup performance
CREATE INDEX IF NOT EXISTS idx_users_instagram_handle ON users (instagram_handle);
CREATE INDEX IF NOT EXISTS idx_users_twitter_handle ON users (twitter_handle);
`;

const down = `
-- Revert changes - drop added columns
ALTER TABLE users 
DROP COLUMN IF EXISTS instagram_handle,
DROP COLUMN IF EXISTS twitter_handle,
DROP COLUMN IF EXISTS spotify_handle,
DROP COLUMN IF EXISTS linkedin_handle;

-- Drop created indexes
DROP INDEX IF EXISTS idx_users_instagram_handle;
DROP INDEX IF EXISTS idx_users_twitter_handle;
`;

module.exports = createMigration('Add social media handles to users', up, down); 