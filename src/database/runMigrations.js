const supabase = require('../config/database');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { migrateReportsTable } = require('./migrations/create_reports_table_migration');

// Import migrations
const migrations = [
  // Add your migrations here in order
  require('../migrations/20240602_conversation_analytics'),
  require('../migrations/20240615_achievements'),
  require('../migrations/20240620_conversation_streaks'),
  require('../migrations/20240625_daily_match_wheel'),
  require('../migrations/20240630_mini_games')
];

/**
 * Run a SQL migration from file
 */
const runMigration = async (filename) => {
  try {
    const filePath = path.join(__dirname, 'migrations', filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    logger.info(`Running SQL migration: ${filename}`);
    const { error } = await supabase.query(sql);
    
    if (error) {
      throw error;
    }
    
    logger.info(`Successfully completed migration: ${filename}`);
    return true;
  } catch (error) {
    logger.error(`Migration ${filename} failed:`, error);
    throw error;
  }
};

/**
 * Run JS migrations in sequence
 */
const runJsMigrations = async () => {
  logger.info('Running JS migrations...');
  
  for (const migration of migrations) {
    try {
      logger.info(`Running JS migration: ${migration.name || 'unnamed'}`);
      await migration.up();
      logger.info(`Successfully completed JS migration: ${migration.name || 'unnamed'}`);
    } catch (error) {
      logger.error(`JS migration failed:`, error);
      throw error;
    }
  }
  
  logger.info('All JS migrations completed');
};

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
    
    // Run JS migrations
    await runJsMigrations();
    
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