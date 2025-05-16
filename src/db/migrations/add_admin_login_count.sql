-- Add admin_login_count column to users table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'admin_login_count'
  ) THEN
    ALTER TABLE users ADD COLUMN admin_login_count INTEGER DEFAULT 0;
  END IF;
END $$; 