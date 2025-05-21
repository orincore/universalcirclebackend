const { supabase } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Migration to add conversation_analytics table for storing AI-generated mood analysis
 * and other analytics related to conversations
 */
const up = async () => {
  try {
    logger.info('Starting migration: creating conversation_analytics table');

    // Create conversation_analytics table
    const { error: tableError } = await supabase.query(`
      CREATE TABLE IF NOT EXISTS conversation_analytics (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id UUID NOT NULL,
        analysis_type VARCHAR(50) NOT NULL,
        analysis_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    if (tableError) {
      throw new Error(`Error creating conversation_analytics table: ${tableError.message}`);
    }

    // Create indexes for better query performance
    const { error: indexError } = await supabase.query(`
      CREATE INDEX IF NOT EXISTS idx_conversation_analytics_conversation_id
        ON conversation_analytics (conversation_id);
      
      CREATE INDEX IF NOT EXISTS idx_conversation_analytics_type
        ON conversation_analytics (analysis_type);
        
      CREATE INDEX IF NOT EXISTS idx_conversation_analytics_analyzed_at
        ON conversation_analytics (analyzed_at);
    `);

    if (indexError) {
      throw new Error(`Error creating indexes: ${indexError.message}`);
    }

    // Add foreign key constraint if conversations table exists
    try {
      const { error: fkError } = await supabase.query(`
        ALTER TABLE conversation_analytics
        ADD CONSTRAINT fk_conversation_analytics_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE;
      `);

      if (fkError) {
        logger.warn(`Note: Foreign key constraint not added: ${fkError.message}`);
      }
    } catch (fkError) {
      logger.warn('Note: Foreign key constraint not added - conversations table may not exist yet');
    }

    // Enable row level security
    const { error: rlsError } = await supabase.query(`
      -- Enable RLS
      ALTER TABLE conversation_analytics ENABLE ROW LEVEL SECURITY;
      
      -- Create policy for users to view analytics for their own conversations
      CREATE POLICY "Users can view analytics for their conversations"
        ON conversation_analytics
        FOR SELECT
        USING (
          conversation_id IN (
            SELECT id FROM conversations 
            WHERE user1_id = auth.uid() OR user2_id = auth.uid()
          )
        );
      
      -- Create policy for admins to view all analytics
      CREATE POLICY "Admins can view all analytics"
        ON conversation_analytics
        FOR ALL
        USING (
          EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() 
            AND users.is_admin = true
          )
        );
    `);

    if (rlsError) {
      throw new Error(`Error enabling RLS policies: ${rlsError.message}`);
    }

    logger.info('Migration completed: conversation_analytics table created successfully');
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
};

/**
 * Roll back the migration
 */
const down = async () => {
  try {
    logger.info('Starting migration rollback: dropping conversation_analytics table');

    // Drop RLS policies
    const { error: policyError } = await supabase.query(`
      DROP POLICY IF EXISTS "Users can view analytics for their conversations" ON conversation_analytics;
      DROP POLICY IF EXISTS "Admins can view all analytics" ON conversation_analytics;
    `);

    if (policyError) {
      logger.warn(`Note: Error dropping policies: ${policyError.message}`);
    }

    // Drop the table
    const { error: dropError } = await supabase.query(`
      DROP TABLE IF EXISTS conversation_analytics CASCADE;
    `);

    if (dropError) {
      throw new Error(`Error dropping conversation_analytics table: ${dropError.message}`);
    }

    logger.info('Migration rollback completed: conversation_analytics table dropped');
  } catch (error) {
    logger.error(`Migration rollback failed: ${error.message}`);
    throw error;
  }
};

module.exports = {
  up,
  down
}; 