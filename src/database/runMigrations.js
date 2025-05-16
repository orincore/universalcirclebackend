const supabase = require('../config/database');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { migrateReportsTable } = require('./migrations/create_reports_table_migration');

/**
 * Run all database migrations in the correct order
 */
const runMigrations = async () => {
  try {
    logger.info('Starting database migrations...');
    
    // Run migrations in sequence
    await migrateReportsTable();
    
    // Create user_interests table
    await runMigration('createUserInterestsTable.sql');
    
    // Create admin activity log table
    await runMigration('createAdminActivityLog.sql');
    
    // Create Gemini AI user for automated actions
    await runMigration('createGeminiUser.sql');

    // Create test users for moderation testing
    await runMigration('createTestUsers.sql');
    
    logger.info('All migrations completed successfully!');
    return true;
  } catch (error) {
    logger.error('Migration process failed:', error);
    return false;
  }
};

/**
 * Run migrations if this script is executed directly
 */
if (require.main === module) {
  runMigrations()
    .then(success => {
      if (success) {
        console.log('Migrations completed successfully.');
        process.exit(0);
      } else {
        console.error('Migrations failed. Check logs for details.');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unhandled error during migrations:', error);
      process.exit(1);
    });
}

module.exports = {
  runMigrations
}; 