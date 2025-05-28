console.log("Creating test file to debug field updates")

const supabase = require('./src/config/database');
const { updateUserProfile } = require('./src/services/userService');

async function debugProfileUpdates() {
  try {
    // Use a test user ID - you'll need to replace this with a valid user ID
    const userId = '2be4b2e4-d8c4-46cd-9a6e-e41a2d30b96a'; // Replace with a valid test user ID
    
    // Get current user data
    console.log(`Fetching current user data for ${userId}...`);
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (userError) {
      console.error('Error fetching user:', userError);
      return;
    }
    
    console.log('Current user data:', JSON.stringify(user, null, 2));
    
    // Test case 1: Update first_name and last_name
    console.log('\n--- Test Case 1: Update first_name and last_name ---');
    const nameUpdateData = {
      first_name: 'NewFirstName',
      last_name: 'NewLastName'
    };
    console.log('Attempting to update with:', nameUpdateData);
    const nameResult = await updateUserProfile(userId, nameUpdateData);
    console.log('Result:', nameResult ? 'Success' : 'Failed');
    if (nameResult) {
      console.log('Updated user:', JSON.stringify(nameResult, null, 2));
    }
    
    // Test case 2: Update location
    console.log('\n--- Test Case 2: Update location ---');
    // Try different location formats
    const locationObj = {
      latitude: 37.7749,
      longitude: -122.4194
    };
    const locationUpdateData = {
      location: locationObj
    };
    console.log('Attempting to update with location object:', locationUpdateData);
    const locationResult = await updateUserProfile(userId, locationUpdateData);
    console.log('Result:', locationResult ? 'Success' : 'Failed');
    if (locationResult) {
      console.log('Updated user:', JSON.stringify(locationResult, null, 2));
    }
    
    // Test case 3: Update preferences
    console.log('\n--- Test Case 3: Update preferences ---');
    // Try different preference formats
    const preferencesObj = {
      notifications: true,
      theme: 'dark',
      privacy: 'public'
    };
    const preferencesUpdateData = {
      preferences: preferencesObj
    };
    console.log('Attempting to update with preferences object:', preferencesUpdateData);
    const preferencesResult = await updateUserProfile(userId, preferencesUpdateData);
    console.log('Result:', preferencesResult ? 'Success' : 'Failed');
    if (preferencesResult) {
      console.log('Updated user:', JSON.stringify(preferencesResult, null, 2));
    }
    
    // Test case 4: Also try updating the "preference" field (singular)
    console.log('\n--- Test Case 4: Update preference field ---');
    const preferenceUpdateData = {
      preference: 'Dating'
    };
    console.log('Attempting to update with preference value:', preferenceUpdateData);
    const preferenceResult = await updateUserProfile(userId, preferenceUpdateData);
    console.log('Result:', preferenceResult ? 'Success' : 'Failed');
    if (preferenceResult) {
      console.log('Updated user:', JSON.stringify(preferenceResult, null, 2));
    }
    
    // Get final user data
    console.log('\n--- Final User Data ---');
    const { data: finalUser, error: finalError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (finalError) {
      console.error('Error fetching final user:', finalError);
      return;
    }
    
    console.log('Final user data:', JSON.stringify(finalUser, null, 2));
    
  } catch (err) {
    console.error('Debug error:', err);
  }
}

debugProfileUpdates().then(() => console.log('Debug complete')).catch(console.error);
