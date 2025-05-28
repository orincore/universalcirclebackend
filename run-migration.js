require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Connected to database, running migration...');
    
    // Read the SQL file
    const sqlFilePath = path.join(__dirname, 'migrations', 'add_social_media_handles.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    
    // Start a transaction
    await client.query('BEGIN');
    
    // Execute the SQL
    await client.query(sql);
    
    // Commit the transaction
    await client.query('COMMIT');
    
    console.log('Migration completed successfully!');
    
    // Verify the columns were added
    const { rows } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('instagram_handle', 'twitter_handle', 'spotify_handle', 'linkedin_handle')
    `);
    
    console.log('Verified columns:', rows.map(row => row.column_name));
    
  } catch (error) {
    // Rollback the transaction if there was an error
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    // Release the client back to the pool
    client.release();
    pool.end();
  }
}

runMigration(); 