/**
 * Migration to create the reported_messages table
 * 
 * This table links reports to specific messages that were reported
 */

const supabase = require('../config/database');

const up = async () => {
  console.log('Running migration: create reported_messages table');
  
  // Create the reported_messages table if it doesn't exist
  const { error: createError } = await supabase.query(`
    CREATE TABLE IF NOT EXISTS reported_messages (
      id SERIAL PRIMARY KEY,
      report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
      message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(report_id, message_id)
    );
  `);
  
  if (createError) {
    console.error('Error creating reported_messages table:', createError);
    throw createError;
  }
  
  // Create index for faster lookups
  const { error: indexError } = await supabase.query(`
    CREATE INDEX IF NOT EXISTS idx_reported_messages_report_id ON reported_messages(report_id);
    CREATE INDEX IF NOT EXISTS idx_reported_messages_message_id ON reported_messages(message_id);
  `);
  
  if (indexError) {
    console.error('Error creating indexes:', indexError);
    throw indexError;
  }
  
  console.log('Migration completed: created reported_messages table');
};

const down = async () => {
  console.log('Running down migration: drop reported_messages table');
  
  // Drop the reported_messages table
  const { error } = await supabase.query(`
    DROP TABLE IF EXISTS reported_messages CASCADE;
  `);
  
  if (error) {
    console.error('Error dropping reported_messages table:', error);
    throw error;
  }
  
  console.log('Down migration completed: dropped reported_messages table');
};

module.exports = {
  up,
  down
}; 