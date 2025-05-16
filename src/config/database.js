const { createClient } = require('@supabase/supabase-js');

// Get environment variables that were loaded in index.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Supabase credentials not found in environment variables');
  console.error('SUPABASE_URL:', SUPABASE_URL ? 'Found' : 'Missing');
  console.error('SUPABASE_KEY:', SUPABASE_KEY ? 'Found' : 'Missing');
  throw new Error('Supabase credentials not properly configured in .env file');
}

// Create a single supabase client for interacting with the database
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Supabase client initialized successfully');

module.exports = supabase; 