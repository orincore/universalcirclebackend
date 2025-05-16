-- Function to create the reports table
CREATE OR REPLACE FUNCTION create_reports_table()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if table exists
  IF NOT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'reports'
  ) THEN
    -- Create the reports table
    CREATE TABLE reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      content_type VARCHAR(50) NOT NULL, -- 'message', 'user', 'post'
      content_id UUID NOT NULL,
      report_type VARCHAR(100) NOT NULL, -- Category of report
      comment TEXT, -- Optional user comment
      reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
      admin_comment TEXT, -- For admin responses
      resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
    );
    
    -- Create indexes for better query performance
    CREATE INDEX idx_reports_content ON reports(content_type, content_id);
    CREATE INDEX idx_reports_reporter ON reports(reporter_id);
    CREATE INDEX idx_reports_status ON reports(status);
    CREATE INDEX idx_reports_created_at ON reports(created_at);
    
    -- Create function to check if table exists
    CREATE OR REPLACE FUNCTION check_table_exists(p_table_name TEXT)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = p_table_name
      );
    END;
    $$;
  END IF;
END;
$$; 