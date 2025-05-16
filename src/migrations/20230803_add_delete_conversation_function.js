const supabase = require('../config/database');

/**
 * Migration to add a delete_conversation_data stored procedure
 */
const up = async () => {
  console.log('Running migration: add delete_conversation_data function');
  
  // Create the delete_conversation_data function
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE OR REPLACE FUNCTION delete_conversation_data(current_user_id UUID, other_user_id UUID)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      BEGIN
        -- Delete all messages between the two users
        DELETE FROM messages
        WHERE (sender_id = current_user_id AND receiver_id = other_user_id)
           OR (sender_id = other_user_id AND receiver_id = current_user_id);
        
        -- Find and update any match to removed status
        UPDATE matches
        SET status = 'removed', updated_at = NOW()
        WHERE ((user1_id = current_user_id AND user2_id = other_user_id)
            OR (user1_id = other_user_id AND user2_id = current_user_id))
          AND status = 'accepted';
        
        RETURN;
      END;
      $$;
    `
  });

  if (error) {
    console.error('Error creating delete_conversation_data function:', error);
    throw error;
  }

  console.log('Successfully created delete_conversation_data function');
};

/**
 * Migration to remove the delete_conversation_data stored procedure
 */
const down = async () => {
  console.log('Running rollback: remove delete_conversation_data function');
  
  // Drop the delete_conversation_data function
  const { error } = await supabase.rpc('exec_sql', {
    sql: `DROP FUNCTION IF EXISTS delete_conversation_data;`
  });

  if (error) {
    console.error('Error dropping delete_conversation_data function:', error);
    throw error;
  }

  console.log('Successfully dropped delete_conversation_data function');
};

module.exports = {
  up,
  down
}; 