require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// Get Supabase credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Supabase credentials not found in environment variables');
  process.exit(1);
}

// Create a Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function updateUserPassword(userId, newPassword) {
  try {
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update the user's password
    const { data, error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId)
      .select('id, username, email')
      .single();
    
    if (error) {
      console.error('Error updating user password:', error);
      return;
    }
    
    console.log('User password updated successfully:');
    console.log(data);
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// The user ID and new password
const userId = process.argv[2];
const newPassword = process.argv[3];

if (!userId || !newPassword) {
  console.error('Please provide a user ID and new password as command line arguments');
  process.exit(1);
}

updateUserPassword(userId, newPassword)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
  }); 