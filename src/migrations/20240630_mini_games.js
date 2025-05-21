const { supabase } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply mini games migration
 */
const up = async () => {
  try {
    logger.info('Running mini games migration - up');
    
    // Create games table to store available game types
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS mini_games (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        rules JSONB DEFAULT '{}',
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Index for faster queries
      CREATE INDEX IF NOT EXISTS idx_mini_games_type
        ON mini_games(type);
      CREATE INDEX IF NOT EXISTS idx_mini_games_enabled
        ON mini_games(enabled);
    `);
    
    // Create game instances table for active games
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS game_instances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_id UUID NOT NULL REFERENCES mini_games(id),
        conversation_id UUID NOT NULL,
        initiator_id UUID NOT NULL REFERENCES users(id),
        responder_id UUID NOT NULL REFERENCES users(id),
        status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, active, completed, expired
        state JSONB DEFAULT '{}',
        score JSONB DEFAULT '{}',
        expires_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Indexes for faster queries
      CREATE INDEX IF NOT EXISTS idx_game_instances_conversation
        ON game_instances(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_game_instances_participants
        ON game_instances(initiator_id, responder_id);
      CREATE INDEX IF NOT EXISTS idx_game_instances_status
        ON game_instances(status);
      CREATE INDEX IF NOT EXISTS idx_game_instances_expires
        ON game_instances(expires_at);
    `);
    
    // Create game messages table to store game-related messages
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS game_moves (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        game_instance_id UUID NOT NULL REFERENCES game_instances(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),
        move_data JSONB NOT NULL,
        move_number INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Indexes for faster queries
      CREATE INDEX IF NOT EXISTS idx_game_moves_instance
        ON game_moves(game_instance_id);
      CREATE INDEX IF NOT EXISTS idx_game_moves_user
        ON game_moves(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_moves_number
        ON game_moves(move_number);
    `);
    
    // Insert default game types
    await supabase.query(`
      INSERT INTO mini_games (name, type, description, rules)
      VALUES
        ('Emoji Guess', 'emoji_guess', 'Guess the meaning of emoji combinations', '{
          "rounds": 5,
          "time_limit_seconds": 30,
          "points_correct": 10,
          "points_fast_bonus": 5
        }'),
        ('Word Association', 'word_association', 'Respond with a related word as quickly as possible', '{
          "rounds": 10,
          "time_limit_seconds": 15,
          "points_per_word": 5,
          "disallowed_words": ["the", "a", "an", "and", "but", "or"]
        }'),
        ('Truth or Dare', 'truth_or_dare', 'Answer personal questions or perform daring tasks', '{
          "rounds": 6,
          "truth_ratio": 0.6,
          "dare_ratio": 0.4,
          "points_per_completion": 10
        }'),
        ('Trivia Challenge', 'trivia', 'Test your knowledge with fun trivia questions', '{
          "rounds": 5,
          "categories": ["general", "science", "entertainment", "history", "geography"],
          "difficulty_levels": ["easy", "medium", "hard"],
          "points_easy": 5,
          "points_medium": 10,
          "points_hard": 15
        }'),
        ('Two Truths and a Lie', 'two_truths_lie', 'Share two true statements and one false one', '{
          "rounds": 3,
          "points_correct_guess": 10,
          "points_successful_deception": 15
        }')
      ON CONFLICT (id) DO NOTHING;
    `);
    
    // Enable Row Level Security
    await supabase.query(`
      -- Enable RLS on mini_games
      ALTER TABLE mini_games ENABLE ROW LEVEL SECURITY;
      
      -- Anyone can view available games
      CREATE POLICY "Anyone can view available games"
        ON mini_games
        FOR SELECT
        USING (enabled = true);
      
      -- Only admins can modify games
      CREATE POLICY "Only admins can modify games"
        ON mini_games
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on game_instances
      ALTER TABLE game_instances ENABLE ROW LEVEL SECURITY;
      
      -- Users can view game instances they're part of
      CREATE POLICY "Users can view their game instances"
        ON game_instances
        FOR SELECT
        USING (
          initiator_id = auth.uid() OR
          responder_id = auth.uid()
        );
      
      -- Users can create game instances
      CREATE POLICY "Users can create game instances"
        ON game_instances
        FOR INSERT
        WITH CHECK (
          initiator_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Users can update their game instances
      CREATE POLICY "Users can update their game instances"
        ON game_instances
        FOR UPDATE
        USING (
          initiator_id = auth.uid() OR
          responder_id = auth.uid() OR
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
      
      -- Enable RLS on game_moves
      ALTER TABLE game_moves ENABLE ROW LEVEL SECURITY;
      
      -- Users can view moves from games they're part of
      CREATE POLICY "Users can view moves from their games"
        ON game_moves
        FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM game_instances
            WHERE game_instances.id = game_moves.game_instance_id
            AND (game_instances.initiator_id = auth.uid() OR game_instances.responder_id = auth.uid())
          )
        );
      
      -- Users can insert moves for their games
      CREATE POLICY "Users can insert moves for their games"
        ON game_moves
        FOR INSERT
        WITH CHECK (
          user_id = auth.uid() AND
          EXISTS (
            SELECT 1 FROM game_instances
            WHERE game_instances.id = game_moves.game_instance_id
            AND (game_instances.initiator_id = auth.uid() OR game_instances.responder_id = auth.uid())
            AND game_instances.status = 'active'
          )
        );
    `);
    
    logger.info('Mini games migration - up completed');
  } catch (error) {
    logger.error(`Mini games migration - up failed: ${error.message}`);
    throw error;
  }
};

/**
 * Revert mini games migration
 */
const down = async () => {
  try {
    logger.info('Running mini games migration - down');
    
    // Drop policies
    await supabase.query(`
      DROP POLICY IF EXISTS "Anyone can view available games" ON mini_games;
      DROP POLICY IF EXISTS "Only admins can modify games" ON mini_games;
      DROP POLICY IF EXISTS "Users can view their game instances" ON game_instances;
      DROP POLICY IF EXISTS "Users can create game instances" ON game_instances;
      DROP POLICY IF EXISTS "Users can update their game instances" ON game_instances;
      DROP POLICY IF EXISTS "Users can view moves from their games" ON game_moves;
      DROP POLICY IF EXISTS "Users can insert moves for their games" ON game_moves;
    `);
    
    // Drop tables (in correct order due to foreign key constraints)
    await supabase.query(`
      DROP TABLE IF EXISTS game_moves;
      DROP TABLE IF EXISTS game_instances;
      DROP TABLE IF EXISTS mini_games;
    `);
    
    logger.info('Mini games migration - down completed');
  } catch (error) {
    logger.error(`Mini games migration - down failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  up,
  down
}; 