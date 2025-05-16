/**
 * Database configuration for PostgreSQL connection pool
 */
const { Pool } = require('pg');
const { info, error } = require('../utils/logger');

// Create a connection pool using environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test the connection
pool.connect()
  .then(client => {
    info('PostgreSQL database connection established');
    client.release();
  })
  .catch(err => {
    error('Error connecting to PostgreSQL database:', err);
  });

module.exports = {
  pool
}; 