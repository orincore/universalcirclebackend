const { supabase } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply achievement system migration
 */
const up = async () => {
  try {
    logger.info('Running achievement system migration - up');
    
    // Create achievements table
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        badge_icon VARCHAR(255) NOT NULL,
        badge_color VARCHAR(50) NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        requirement_type VARCHAR(50) NOT NULL,
        requirement_count INTEGER NOT NULL DEFAULT 1,
        category VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Index on category for faster filtering
      CREATE INDEX IF NOT EXISTS idx_achievements_category ON achievements(category);
    `);
    
    // Create user_achievements table to track earned achievements
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
        earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        progress INTEGER DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        notified BOOLEAN DEFAULT FALSE,
        
        -- Ensure each user can only have one entry per achievement
        CONSTRAINT unique_user_achievement UNIQUE (user_id, achievement_id)
      );

      -- Indexes for faster queries
      CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_achievements_completed ON user_achievements(completed);
    `);
    
    // Enable Row Level Security
    await supabase.query(`
      -- Enable RLS on achievements
      ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
      
      -- Anyone can read achievements
      CREATE POLICY "Anyone can view achievements"
        ON achievements
        FOR SELECT
        USING (true);
      
      -- Only admins can modify achievements
      CREATE POLICY "Only admins can modify achievements"
        ON achievements
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on user_achievements
      ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
      
      -- Users can read their own achievements
      CREATE POLICY "Users can view their own achievements"
        ON user_achievements
        FOR SELECT
        USING (user_id = auth.uid());
      
      -- Users can read other users' completed achievements (for public profiles)
      CREATE POLICY "Users can view other users' completed achievements"
        ON user_achievements
        FOR SELECT
        USING (completed = true);
      
      -- Only the system can insert/update user achievements
      CREATE POLICY "Only admins can modify user achievements"
        ON user_achievements
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.is_admin = true
          )
        );
    `);
    
    // Insert default achievements
    await supabase.query(`
      INSERT INTO achievements (name, description, badge_icon, badge_color, points, requirement_type, requirement_count, category)
      VALUES
        ('Profile Perfectionist', 'Complete 100% of your profile', 'profile_star', 'gold', 100, 'profile_completion', 100, 'profile'),
        ('Conversation Starter', 'Start your first conversation', 'chat_bubble', 'blue', 10, 'conversations_started', 1, 'messaging'),
        ('Social Butterfly', 'Match with 10 other users', 'butterfly', 'purple', 50, 'matches', 10, 'social'),
        ('Speed Dater', 'Get 5 matches in a single day', 'lightning', 'yellow', 75, 'daily_matches', 5, 'social'),
        ('Streak Master', 'Maintain a 7-day conversation streak', 'fire', 'orange', 100, 'conversation_streak', 7, 'messaging'),
        ('Photo Maven', 'Upload 5 profile pictures', 'camera', 'teal', 30, 'profile_pictures', 5, 'profile'),
        ('Voice Virtuoso', 'Add a voice bio to your profile', 'microphone', 'purple', 50, 'voice_bio', 1, 'profile'),
        ('Verified User', 'Get your profile verified', 'check_badge', 'blue', 200, 'verified', 1, 'trust'),
        ('Early Adopter', 'Join during the app''s first month', 'rocket', 'gold', 150, 'early_adopter', 1, 'membership'),
        ('Daily Logger', 'Log in for 14 consecutive days', 'calendar', 'green', 100, 'login_streak', 14, 'engagement')
      ON CONFLICT (id) DO NOTHING;
    `);
    
    logger.info('Achievement system migration - up completed');
  } catch (error) {
    logger.error(`Achievement system migration - up failed: ${error.message}`);
    throw error;
  }
};

/**
 * Revert achievement system migration
 */
const down = async () => {
  try {
    logger.info('Running achievement system migration - down');
    
    // Drop policies
    await supabase.query(`
      DROP POLICY IF EXISTS "Anyone can view achievements" ON achievements;
      DROP POLICY IF EXISTS "Only admins can modify achievements" ON achievements;
      DROP POLICY IF EXISTS "Users can view their own achievements" ON user_achievements;
      DROP POLICY IF EXISTS "Users can view other users' completed achievements" ON user_achievements;
      DROP POLICY IF EXISTS "Only admins can modify user achievements" ON user_achievements;
    `);
    
    // Drop tables (in correct order due to foreign key constraints)
    await supabase.query(`
      DROP TABLE IF EXISTS user_achievements;
      DROP TABLE IF EXISTS achievements;
    `);
    
    logger.info('Achievement system migration - down completed');
  } catch (error) {
    logger.error(`Achievement system migration - down failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  up,
  down
}; 