/**
 * Migration Runner Script
 * 
 * This script runs database migrations in the migrations directory.
 * 
 * Usage: node src/migrations/run.js <migration_name>
 * 
 * Example: node src/migrations/run.js notification_tables
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// Get the migration name from command line args
const migrationName = process.argv[2];

if (!migrationName) {
  logger.error('No migration name provided. Usage: node src/migrations/run.js <migration_name>');
  process.exit(1);
}

// Path to migration file
const migrationPath = path.join(__dirname, `${migrationName}.js`);

// Check if migration file exists
if (!fs.existsSync(migrationPath)) {
  logger.error(`Migration file not found: ${migrationName}.js`);
  logger.info('Available migrations:');
  
  // List available migrations
  const migrationFiles = fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.js') && file !== 'run.js')
    .map(file => file.replace('.js', ''));
    
  migrationFiles.forEach(file => logger.info(`- ${file}`));
  
  process.exit(1);
}

// Run the migration
async function runMigration() {
  try {
    logger.info(`Running migration: ${migrationName}`);
    
    // Import the migration module
    const migration = require(`./${migrationName}`);
    
    // Run the migration
    if (typeof migration.up === 'function') {
      const result = await migration.up();
      
      if (result && result.success) {
        logger.info(`Migration ${migrationName} completed successfully`);
        process.exit(0);
      } else {
        const errorMessage = result && result.error ? result.error.message : 'Unknown error';
        logger.error(`Migration ${migrationName} failed: ${errorMessage}`);
        process.exit(1);
      }
    } else {
      logger.error(`Migration ${migrationName} does not export an 'up' function`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`Error running migration ${migrationName}: ${error.message}`);
    process.exit(1);
  }
}

runMigration(); 