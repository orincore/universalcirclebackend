-- Function to check if table exists
CREATE OR REPLACE FUNCTION check_table_exists(p_table_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  table_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = p_table_name
  ) INTO table_exists;
  
  RETURN table_exists;
END;
$$ LANGUAGE plpgsql;

-- Create admin_activity_log table if it doesn't exist
DO $$ 
BEGIN
  IF NOT (SELECT check_table_exists('admin_activity_log')) THEN
    CREATE TABLE admin_activity_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      admin_id UUID REFERENCES users(id),
      action VARCHAR NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resource_type VARCHAR,
      resource_id UUID
    );
    
    -- Create indexes
    CREATE INDEX admin_activity_log_admin_id_idx ON admin_activity_log(admin_id);
    CREATE INDEX admin_activity_log_resource_type_idx ON admin_activity_log(resource_type);
    CREATE INDEX admin_activity_log_created_at_idx ON admin_activity_log(created_at);
    
    -- Add comment
    COMMENT ON TABLE admin_activity_log IS 'Logs all admin actions including AI moderation';
  END IF;
END $$; 