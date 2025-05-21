const { supabase } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply conversation streaks migration
 */
const up = async () => {
  try {
    logger.info('Running conversation streaks migration - up');
    
    // Create conversation_streaks table
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS conversation_streaks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID NOT NULL,
        user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_streak INTEGER DEFAULT 1,
        longest_streak INTEGER DEFAULT 1,
        last_message_at TIMESTAMP WITH TIME ZONE NOT NULL,
        streak_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Ensure each conversation has only one streak record
        CONSTRAINT unique_conversation_streak UNIQUE (conversation_id)
      );

      -- Indexes for faster queries
      CREATE INDEX IF NOT EXISTS idx_conversation_streaks_conversation_id
        ON conversation_streaks(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_streaks_users
        ON conversation_streaks(user1_id, user2_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_streaks_last_message
        ON conversation_streaks(last_message_at);
    `);
    
    // Create streak_milestones table for tracking achievements
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS streak_milestones (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        streak_count INTEGER NOT NULL,
        achieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Each user can only have one record per streak milestone per conversation
        CONSTRAINT unique_user_streak_milestone UNIQUE (conversation_id, user_id, streak_count)
      );

      -- Index for faster queries
      CREATE INDEX IF NOT EXISTS idx_streak_milestones_user
        ON streak_milestones(user_id);
    `);
    
    // Create streak_bonus table for tracking streak rewards
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS streak_bonuses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        streak_count INTEGER NOT NULL,
        bonus_type VARCHAR(50) NOT NULL,
        bonus_data JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Each streak count can only have one bonus
        CONSTRAINT unique_streak_bonus UNIQUE (streak_count)
      );
    `);
    
    // Insert default streak bonuses
    await supabase.query(`
      INSERT INTO streak_bonuses (streak_count, bonus_type, bonus_data)
      VALUES
        (3, 'emoji_pack', '{"pack_name": "Basic Emotions", "emoji_count": 5}'),
        (7, 'custom_background', '{"background_name": "Golden Sunset"}'),
        (14, 'emoji_pack', '{"pack_name": "Super Expressions", "emoji_count": 10}'),
        (30, 'message_effects', '{"effect_name": "Sparkling Text"}'),
        (60, 'profile_badge', '{"badge_name": "Connection Master", "badge_color": "gold"}'),
        (100, 'custom_theme', '{"theme_name": "Royal Streak", "color_scheme": "gold_purple"}')
      ON CONFLICT (streak_count) DO NOTHING;
    `);
    
    // Enable Row Level Security on the tables
    await supabase.query(`
      -- Enable RLS on conversation_streaks
      ALTER TABLE conversation_streaks ENABLE ROW LEVEL SECURITY;
      
      -- Users can see streaks for their conversations
      CREATE POLICY "Users can view their own conversation streaks"
        ON conversation_streaks
        FOR SELECT
        USING (
          user1_id = auth.uid() OR 
          user2_id = auth.uid()
        );
      
      -- Only system can modify streaks
      CREATE POLICY "Only admins can modify streaks"
        ON conversation_streaks
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );

      -- Enable RLS on streak_milestones
      ALTER TABLE streak_milestones ENABLE ROW LEVEL SECURITY;
      
      -- Users can see their own streak milestones
      CREATE POLICY "Users can view their own streak milestones"
        ON streak_milestones
        FOR SELECT
        USING (
          user_id = auth.uid()
        );

      -- Only system can modify streak milestones
      CREATE POLICY "Only admins can modify streak milestones"
        ON streak_milestones
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on streak_bonuses
      ALTER TABLE streak_bonuses ENABLE ROW LEVEL SECURITY;
      
      -- Anyone can view streak bonuses
      CREATE POLICY "Anyone can view streak bonuses"
        ON streak_bonuses
        FOR SELECT
        USING (true);
      
      -- Only admins can modify streak bonuses
      CREATE POLICY "Only admins can modify streak bonuses"
        ON streak_bonuses
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
    `);
    
    logger.info('Conversation streaks migration - up completed');
  } catch (error) {
    logger.error(`Conversation streaks migration - up failed: ${error.message}`);
    throw error;
  }
};

/**
 * Revert conversation streaks migration
 */
const down = async () => {
  try {
    logger.info('Running conversation streaks migration - down');
    
    // Drop policies
    await supabase.query(`
      DROP POLICY IF EXISTS "Users can view their own conversation streaks" ON conversation_streaks;
      DROP POLICY IF EXISTS "Only admins can modify streaks" ON conversation_streaks;
      DROP POLICY IF EXISTS "Users can view their own streak milestones" ON streak_milestones;
      DROP POLICY IF EXISTS "Only admins can modify streak milestones" ON streak_milestones;
      DROP POLICY IF EXISTS "Anyone can view streak bonuses" ON streak_bonuses;
      DROP POLICY IF EXISTS "Only admins can modify streak bonuses" ON streak_bonuses;
    `);
    
    // Drop tables (in correct order due to foreign key constraints)
    await supabase.query(`
      DROP TABLE IF EXISTS streak_bonuses;
      DROP TABLE IF EXISTS streak_milestones;
      DROP TABLE IF EXISTS conversation_streaks;
    `);
    
    logger.info('Conversation streaks migration - down completed');
  } catch (error) {
    logger.error(`Conversation streaks migration - down failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  up,
  down
}; 