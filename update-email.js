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

async function updateUserEmail(userId, newEmail) {
  try {
    // Update the user's email
    const { data, error } = await supabase
      .from('users')
      .update({ email: newEmail })
      .eq('id', userId)
      .select('id, username, email, is_admin')
      .single();
    
    if (error) {
      console.error('Error updating user email:', error);
      return;
    }
    
    console.log('User email updated successfully:');
    console.log(data);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// The user ID and new email
const userId = process.argv[2];
const newEmail = process.argv[3];

if (!userId || !newEmail) {
  console.error('Please provide a user ID and new email as command line arguments');
  process.exit(1);
}

updateUserEmail(userId, newEmail)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
  }); 