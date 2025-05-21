const supabase = require('../config/database');
const { info, error } = require('../utils/logger');

/**
 * Migration for adding conversation analytics table
 */
async function up() {
  info('Running migration: 20240602_conversation_analytics');

  try {
    // 1. Create conversation analytics table
    info('Creating conversation_analytics table');
    await supabase.query(`
      CREATE TABLE IF NOT EXISTS conversation_analytics (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id uuid NOT NULL,
        analysis_type text NOT NULL,
        analysis_data jsonb NOT NULL,
        analyzed_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    // 2. Create indexes for better query performance
    info('Creating indexes on conversation_analytics table');
    await supabase.query(`
      CREATE INDEX IF NOT EXISTS idx_convo_analytics_conversation_id ON conversation_analytics(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_convo_analytics_type ON conversation_analytics(analysis_type);
      CREATE INDEX IF NOT EXISTS idx_convo_analytics_analyzed_at ON conversation_analytics(analyzed_at);
    `);

    // 3. Add foreign key constraint if conversations table exists
    try {
      const { data: tableExists } = await supabase.rpc('check_table_exists', { 
        table_name: 'conversations' 
      });
      
      if (tableExists) {
        info('Adding foreign key constraint to conversation_analytics');
        await supabase.query(`
          ALTER TABLE conversation_analytics 
          ADD CONSTRAINT fk_conversation_analytics_conversation_id 
          FOREIGN KEY (conversation_id) 
          REFERENCES conversations(id) 
          ON DELETE CASCADE;
        `);
      } else {
        info('Conversations table not found, skipping foreign key constraint');
      }
    } catch (fkErr) {
      error(`Error adding foreign key constraint: ${fkErr.message}`);
      // Continue with migration even if FK constraint fails
    }

    // 4. Add RLS policies
    info('Setting up RLS policies');
    await supabase.query(`
      ALTER TABLE conversation_analytics ENABLE ROW LEVEL SECURITY;
      
      -- Users can view analytics for conversations they are part of
      CREATE POLICY "Users can view analytics for their conversations"
      ON conversation_analytics FOR SELECT
      USING (
        auth.uid() IN (
          SELECT user1_id FROM conversations WHERE id = conversation_id
          UNION
          SELECT user2_id FROM conversations WHERE id = conversation_id
        )
      );
      
      -- Admins can view all analytics
      CREATE POLICY "Admins can view all analytics"
      ON conversation_analytics FOR SELECT
      USING (auth.uid() IN (SELECT id FROM users WHERE is_admin = true));
      
      -- System can insert analytics
      CREATE POLICY "Service role can insert analytics"
      ON conversation_analytics FOR INSERT
      WITH CHECK (true); -- Restricted via service role permissions
    `);

    info('Migration 20240602_conversation_analytics completed successfully');
    return true;
  } catch (err) {
    error(`Migration 20240602_conversation_analytics failed: ${err.message}`);
    return false;
  }
}

/**
 * Rollback migration
 */
async function down() {
  info('Rolling back migration: 20240602_conversation_analytics');

  try {
    // 1. Drop policies
    info('Dropping policies');
    await supabase.query(`
      DROP POLICY IF EXISTS "Users can view analytics for their conversations" ON conversation_analytics;
      DROP POLICY IF EXISTS "Admins can view all analytics" ON conversation_analytics;
      DROP POLICY IF EXISTS "Service role can insert analytics" ON conversation_analytics;
    `);

    // 2. Drop table
    info('Dropping conversation_analytics table');
    await supabase.query(`DROP TABLE IF EXISTS conversation_analytics;`);

    info('Rollback of migration 20240602_conversation_analytics completed successfully');
    return true;
  } catch (err) {
    error(`Rollback of migration 20240602_conversation_analytics failed: ${err.message}`);
    return false;
  }
}

module.exports = {
  up,
  down
}; 