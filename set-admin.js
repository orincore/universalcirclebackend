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

async function setUserAsAdmin(userId) {
  try {
    // Update the user to make them an admin
    const { data, error } = await supabase
      .from('users')
      .update({ is_admin: true })
      .eq('id', userId)
      .select('id, username, email, is_admin')
      .single();
    
    if (error) {
      console.error('Error updating user:', error);
      return;
    }
    
    console.log('User updated successfully:');
    console.log(data);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// The user ID to update - change this to the user ID you want to make admin
const userId = process.argv[2];

if (!userId) {
  console.error('Please provide a user ID as a command line argument');
  process.exit(1);
}

setUserAsAdmin(userId)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
  }); 