const { supabase } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply daily match wheel migration
 */
const up = async () => {
  try {
    logger.info('Running daily match wheel migration - up');
    
    // Create wheel_rewards table for available rewards
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS wheel_rewards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        value JSONB DEFAULT '{}',
        probability INTEGER NOT NULL DEFAULT 10,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Index for faster queries on reward type
      CREATE INDEX IF NOT EXISTS idx_wheel_rewards_type 
        ON wheel_rewards(type);
      CREATE INDEX IF NOT EXISTS idx_wheel_rewards_enabled 
        ON wheel_rewards(enabled);
    `);
    
    // Create user_wheel_spins table to track when users last spun the wheel
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS user_wheel_spins (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_spin_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        next_available_spin_at TIMESTAMP WITH TIME ZONE NOT NULL,
        total_spins INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Each user can only have one spin record
        CONSTRAINT unique_user_wheel_spin UNIQUE (user_id)
      );
      
      -- Index for faster queries
      CREATE INDEX IF NOT EXISTS idx_user_wheel_spins_user_id 
        ON user_wheel_spins(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_wheel_spins_next_available 
        ON user_wheel_spins(next_available_spin_at);
    `);
    
    // Create user_rewards table to track rewards earned
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS user_rewards (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reward_id UUID NOT NULL REFERENCES wheel_rewards(id) ON DELETE CASCADE,
        claimed BOOLEAN DEFAULT false,
        expires_at TIMESTAMP WITH TIME ZONE,
        claimed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Index for faster queries
        CONSTRAINT unique_user_reward_claim UNIQUE(id, user_id, reward_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_user_rewards_user_id 
        ON user_rewards(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_rewards_claimed 
        ON user_rewards(claimed);
      CREATE INDEX IF NOT EXISTS idx_user_rewards_expires_at 
        ON user_rewards(expires_at);
    `);
    
    // Insert default wheel rewards
    await supabase.query(`
      INSERT INTO wheel_rewards (name, type, description, value, probability)
      VALUES
        ('Super Like', 'super_like', 'Your next like will be highlighted to the recipient', '{"count": 1}', 20),
        ('Profile Boost', 'profile_boost', 'Get 24 hours of increased visibility', '{"duration_hours": 24, "boost_percentage": 50}', 10),
        ('Conversation Starter', 'conversation_starter', 'Get an AI-generated icebreaker for your next match', '{"count": 1}', 25),
        ('Circle Coins', 'circle_coins', 'Receive 50 Circle Coins', '{"amount": 50}', 15),
        ('Big Coin Reward', 'circle_coins', 'Receive 100 Circle Coins', '{"amount": 100}', 5),
        ('Match Peek', 'match_peek', 'See one potential match before they see you', '{"count": 1}', 10),
        ('Extra Daily Matches', 'extra_matches', 'Get 5 additional daily matches', '{"count": 5}', 8),
        ('Custom Message Theme', 'message_theme', 'Unlock a special message bubble theme for 24 hours', '{"duration_hours": 24, "theme": "golden"}', 7)
      ON CONFLICT (id) DO NOTHING;
    `);
    
    // Enable Row Level Security
    await supabase.query(`
      -- Enable RLS on wheel_rewards
      ALTER TABLE wheel_rewards ENABLE ROW LEVEL SECURITY;
      
      -- Anyone can view available rewards
      CREATE POLICY "Anyone can view available rewards"
        ON wheel_rewards
        FOR SELECT
        USING (enabled = true);
      
      -- Only admins can modify rewards
      CREATE POLICY "Only admins can modify rewards"
        ON wheel_rewards
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on user_wheel_spins
      ALTER TABLE user_wheel_spins ENABLE ROW LEVEL SECURITY;
      
      -- Users can view their own spin data
      CREATE POLICY "Users can view their own spin data"
        ON user_wheel_spins
        FOR SELECT
        USING (user_id = auth.uid());
      
      -- Users can update their own spin data
      CREATE POLICY "Users can update their own spin data"
        ON user_wheel_spins
        FOR UPDATE
        USING (user_id = auth.uid());
      
      -- System can insert spin data
      CREATE POLICY "System and users can insert spin data"
        ON user_wheel_spins
        FOR INSERT
        WITH CHECK (
          user_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on user_rewards
      ALTER TABLE user_rewards ENABLE ROW LEVEL SECURITY;
      
      -- Users can view their own rewards
      CREATE POLICY "Users can view their own rewards"
        ON user_rewards
        FOR SELECT
        USING (user_id = auth.uid());
      
      -- Users can update their own rewards (for claiming)
      CREATE POLICY "Users can update their own rewards"
        ON user_rewards
        FOR UPDATE
        USING (user_id = auth.uid());
      
      -- System can insert rewards
      CREATE POLICY "System and users can insert rewards"
        ON user_rewards
        FOR INSERT
        WITH CHECK (
          user_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
    `);
    
    logger.info('Daily match wheel migration - up completed');
  } catch (error) {
    logger.error(`Daily match wheel migration - up failed: ${error.message}`);
    throw error;
  }
};

/**
 * Revert daily match wheel migration
 */
const down = async () => {
  try {
    logger.info('Running daily match wheel migration - down');
    
    // Drop policies
    await supabase.query(`
      DROP POLICY IF EXISTS "Anyone can view available rewards" ON wheel_rewards;
      DROP POLICY IF EXISTS "Only admins can modify rewards" ON wheel_rewards;
      DROP POLICY IF EXISTS "Users can view their own spin data" ON user_wheel_spins;
      DROP POLICY IF EXISTS "Users can update their own spin data" ON user_wheel_spins;
      DROP POLICY IF EXISTS "System and users can insert spin data" ON user_wheel_spins;
      DROP POLICY IF EXISTS "Users can view their own rewards" ON user_rewards;
      DROP POLICY IF EXISTS "Users can update their own rewards" ON user_rewards;
      DROP POLICY IF EXISTS "System and users can insert rewards" ON user_rewards;
    `);
    
    // Drop tables (in correct order due to foreign key constraints)
    await supabase.query(`
      DROP TABLE IF EXISTS user_rewards;
      DROP TABLE IF EXISTS user_wheel_spins;
      DROP TABLE IF EXISTS wheel_rewards;
    `);
    
    logger.info('Daily match wheel migration - down completed');
  } catch (error) {
    logger.error(`Daily match wheel migration - down failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  up,
  down
}; 