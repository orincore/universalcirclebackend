require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { up } = require('./20230803_add_delete_conversation_function');

/**
 * Run the latest migration
 */
async function runMigration() {
  try {
    console.log('Starting migration process...');
    await up();
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration(); 