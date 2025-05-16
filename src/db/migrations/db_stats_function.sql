-- Create a function to get database statistics
CREATE OR REPLACE FUNCTION public.get_db_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'active_connections', active_connections,
    'idle_connections', idle_connections,
    'idle_in_transaction_connections', idle_in_transaction_connections,
    'total_connections', total_connections,
    'max_connections', max_connections,
    'connection_utilization_percentage', connection_utilization_percentage
  ) INTO result
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE state = 'active') AS active_connections,
      COUNT(*) FILTER (WHERE state = 'idle') AS idle_connections,
      COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction_connections,
      COUNT(*) AS total_connections,
      current_setting('max_connections')::int AS max_connections,
      ROUND((COUNT(*)::numeric / current_setting('max_connections')::numeric) * 100, 2) AS connection_utilization_percentage
    FROM pg_stat_activity
  ) stats;

  RETURN result;
END;
$$;

-- Create table for storage usage tracking
CREATE TABLE IF NOT EXISTS public.storage_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_name text NOT NULL,
  used_bytes bigint NOT NULL,
  total_bytes bigint,
  updated_at timestamp with time zone DEFAULT now()
);

-- Create table for query logging
CREATE TABLE IF NOT EXISTS public.query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text NOT NULL,
  execution_time_ms integer NOT NULL,
  rows_affected integer,
  executed_at timestamp with time zone DEFAULT now(),
  executed_by uuid REFERENCES auth.users(id)
);

-- Create table for health checks
CREATE TABLE IF NOT EXISTS public.health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_status text NOT NULL,
  websocket_status text NOT NULL,
  database_status text NOT NULL,
  cpu_usage numeric,
  memory_usage numeric,
  checked_at timestamp with time zone DEFAULT now()
);

-- Grant appropriate permissions
ALTER FUNCTION public.get_db_stats() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_db_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_db_stats() TO service_role;

GRANT ALL ON TABLE public.storage_usage TO authenticated;
GRANT ALL ON TABLE public.storage_usage TO service_role;

GRANT ALL ON TABLE public.query_log TO authenticated;
GRANT ALL ON TABLE public.query_log TO service_role;

GRANT ALL ON TABLE public.health_checks TO authenticated;
GRANT ALL ON TABLE public.health_checks TO service_role; 