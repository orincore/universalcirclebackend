-- Function to create a report with specific values
CREATE OR REPLACE FUNCTION create_report(
  p_content_type VARCHAR,
  p_content_id UUID,
  p_report_type VARCHAR,
  p_reason VARCHAR,
  p_comment TEXT,
  p_reporter_id UUID,
  p_reported_user_id UUID,
  p_reported_post_id UUID
) RETURNS JSON AS $$
DECLARE
  new_report_id UUID;
  result JSON;
BEGIN
  -- Insert the report with all fields explicitly set
  INSERT INTO reports (
    content_type,
    content_id,
    report_type,
    reason,
    comment,
    reporter_id,
    reported_user_id,
    reported_post_id,
    status,
    created_at
  ) VALUES (
    p_content_type,
    p_content_id,
    p_report_type,
    p_reason,
    p_comment,
    p_reporter_id,
    p_reported_user_id,
    p_reported_post_id,
    'pending',
    NOW()
  ) RETURNING id INTO new_report_id;
  
  -- Return the new report ID as JSON
  SELECT json_build_object('id', new_report_id) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql; 