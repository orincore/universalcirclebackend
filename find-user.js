require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Supabase credentials not found in environment variables');
  process.exit(1);
}

// Create a Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function findUserByEmail(email) {
  try {
    // Find the user by email
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, is_admin')
      .eq('email', email)
      .single();
    
    if (error) {
      console.error('Error finding user:', error);
      return;
    }
    
    if (!data) {
      console.log('No user found with that email');
      return;
    }
    
    console.log('User found:');
    console.log(data);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// The email to search for
const email = process.argv[2];

if (!email) {
  console.error('Please provide an email as a command line argument');
  process.exit(1);
}

findUserByEmail(email)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
  }); 