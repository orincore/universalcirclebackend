/**
 * Migration to add message deletion fields to messages table
 * 
 * This allows users to delete messages from their own view without affecting
 * the other user, and permanently delete when both users have deleted.
 */

const supabase = require('../config/database');

const up = async () => {
  console.log('Running migration: add message deletion fields');
  
  // Add deleted_by_sender and deleted_by_receiver columns to messages table
  const { error: alterError } = await supabase.rpc('add_message_deletion_columns');
  
  if (alterError) {
    console.error('Error adding message deletion columns:', alterError);
    throw alterError;
  }
  
  // Create the stored procedure if it doesn't exist
  const createProcedure = `
    CREATE OR REPLACE FUNCTION add_message_deletion_columns()
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      -- Check if columns already exist
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'deleted_by_sender'
      ) THEN
        -- Add deleted_by_sender column with default value of false
        ALTER TABLE messages ADD COLUMN deleted_by_sender BOOLEAN DEFAULT false;
      END IF;
      
      IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'deleted_by_receiver'
      ) THEN
        -- Add deleted_by_receiver column with default value of false
        ALTER TABLE messages ADD COLUMN deleted_by_receiver BOOLEAN DEFAULT false;
      END IF;
    END;
    $$;
  `;
  
  // Execute the procedure creation
  const { error: procError } = await supabase.rpc('add_message_deletion_columns');
  
  if (procError) {
    console.error('Error creating procedure:', procError);
    throw procError;
  }
  
  console.log('Migration completed: added message deletion fields');
};

const down = async () => {
  console.log('Running down migration: remove message deletion fields');
  
  // Remove deleted_by_sender and deleted_by_receiver columns from messages table
  const { error: dropSenderError } = await supabase.query(`
    ALTER TABLE messages DROP COLUMN IF EXISTS deleted_by_sender;
  `);
  
  if (dropSenderError) {
    console.error('Error removing deleted_by_sender column:', dropSenderError);
    throw dropSenderError;
  }
  
  const { error: dropReceiverError } = await supabase.query(`
    ALTER TABLE messages DROP COLUMN IF EXISTS deleted_by_receiver;
  `);
  
  if (dropReceiverError) {
    console.error('Error removing deleted_by_receiver column:', dropReceiverError);
    throw dropReceiverError;
  }
  
  console.log('Down migration completed: removed message deletion fields');
};

module.exports = {
  up,
  down
}; 