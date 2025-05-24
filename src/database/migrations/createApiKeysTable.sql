-- Create API keys table for API key management and usage tracking
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE,
    usage_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active', -- active, revoked
    rate_limit INTEGER DEFAULT 100, -- requests per day
    permissions JSONB DEFAULT '{}'::JSONB
);

-- Create index for faster lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

-- Create index for API key status
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status); 