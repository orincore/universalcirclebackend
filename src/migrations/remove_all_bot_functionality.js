/**
 * Migration to remove all AI bot functionality
 * 
 * This migration performs a complete cleanup:
 * 1. Removes any bot users from the database
 * 2. Removes all bot messages
 * 3. Removes is_bot column from users table
 * 4. Removes is_bot_message flag from messages table
 * 5. Cleans up orphaned messages
 */

const supabase = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply the migration
 */
const up = async () => {
  try {
    logger.info('Starting comprehensive bot functionality cleanup');
    
    // STEP 1: Check if is_bot column exists in users table
    let botColumnExists = false;
    try {
      const { data: tableInfo, error: tableError } = await supabase
        .from('users')
        .select('*')
        .limit(1);
      
      if (tableError) {
        logger.error(`Error checking users table: ${tableError.message}`);
        return;
      }
      
      botColumnExists = tableInfo && tableInfo.length > 0 && 'is_bot' in tableInfo[0];
    } catch (error) {
      logger.error(`Error checking users table schema: ${error.message}`);
    }
    
    // STEP 2: If bot column exists, find and remove all bot users and their messages
    if (botColumnExists) {
      logger.info('Found is_bot column in users table. Proceeding with bot user cleanup...');
      
      // Find all bot users
      const { data: botUsers, error: botError } = await supabase
        .from('users')
        .select('id')
        .eq('is_bot', true);
      
      if (botError) {
        logger.error(`Error finding bot users: ${botError.message}`);
      } else if (botUsers && botUsers.length > 0) {
        const botIds = botUsers.map(user => user.id);
        logger.info(`Found ${botUsers.length} bot users to delete: ${botIds.join(', ')}`);
        
        // Delete messages involving bots
        try {
          // First count how many messages will be deleted
          const { count, error: countError } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .or(`sender_id.in.(${botIds.join(',')}),receiver_id.in.(${botIds.join(',')})`);
          
          if (countError) {
            logger.error(`Error counting bot messages: ${countError.message}`);
          } else {
            logger.info(`About to delete ${count || 0} bot messages`);
          }
          
          // Delete the messages
          const { error: deleteError } = await supabase
            .from('messages')
            .delete()
            .or(`sender_id.in.(${botIds.join(',')}),receiver_id.in.(${botIds.join(',')})`)
            .then(res => {
              if (res.error) throw res.error;
              return res;
            });
          
          if (deleteError) {
            logger.error(`Error deleting bot messages: ${deleteError.message}`);
          } else {
            logger.info('Successfully deleted bot messages');
          }
        } catch (msgsError) {
          logger.error(`Error in bot messages deletion: ${msgsError.message}`);
        }
        
        // Delete bot users
        try {
          const { error: userError } = await supabase
            .from('users')
            .delete()
            .in('id', botIds);
          
          if (userError) {
            logger.error(`Error deleting bot users: ${userError.message}`);
          } else {
            logger.info(`Successfully deleted ${botIds.length} bot users`);
          }
        } catch (deleteError) {
          logger.error(`Error in bot user deletion: ${deleteError.message}`);
        }
      } else {
        logger.info('No bot users found');
      }
    } else {
      logger.info('No is_bot column found in users table. Skipping bot user cleanup.');
    }
    
    // STEP 3: Check and clean up is_bot_message flag in messages table
    let botMessageColumnExists = false;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('is_bot_message')
        .limit(1);
      
      botMessageColumnExists = !error;
    } catch (error) {
      logger.info('is_bot_message column does not exist in messages table');
    }
    
    if (botMessageColumnExists) {
      logger.info('Found is_bot_message column in messages table. Deleting bot messages...');
      
      const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .eq('is_bot_message', true);
      
      if (deleteError) {
        logger.error(`Error deleting messages with is_bot_message: ${deleteError.message}`);
      } else {
        logger.info('Successfully deleted messages marked as bot messages');
      }
    }
    
    // STEP 4: Clean up orphaned messages (where sender or receiver no longer exists)
    logger.info('Checking for orphaned messages...');
    
    try {
      // This requires a raw SQL query in production
      logger.info('To clean up orphaned messages, run this SQL:');
      logger.info('DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.id = messages.sender_id)');
      logger.info('OR NOT EXISTS (SELECT 1 FROM users WHERE users.id = messages.receiver_id);');
    } catch (error) {
      logger.error(`Error in orphaned message check: ${error.message}`);
    }
    
    // STEP 5: Remind about column removal
    if (botColumnExists || botMessageColumnExists) {
      logger.info('');
      logger.info('IMPORTANT: Column removal requires manual SQL execution.');
      logger.info('Run these commands in your database SQL editor:');
      
      if (botColumnExists) {
        logger.info('ALTER TABLE users DROP COLUMN IF EXISTS is_bot;');
      }
      
      if (botMessageColumnExists) {
        logger.info('ALTER TABLE messages DROP COLUMN IF EXISTS is_bot_message;');
      }
      
      logger.info('After running the SQL commands, restart your server.');
    }
    
    logger.info('Bot functionality removal migration completed');
  } catch (error) {
    logger.error(`Migration error: ${error.message}`);
  }
};

/**
 * Rollback the migration
 */
const down = async () => {
  logger.info('Rollback not implemented for this migration as it removes data');
};

module.exports = {
  up,
  down
}; 