const axios = require('axios');
require('dotenv').config(); // Load environment variables

// Base URL for API requests
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

// Mock JWT token - replace with a valid token for testing
const TEST_TOKEN = process.env.TEST_TOKEN || 'your-test-token-here';

// Set up axios instance with auth headers
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

/**
 * Run profile update tests
 */
async function testProfileUpdates() {
  try {
    console.log('📝 Starting profile update tests...');
    
    // Test 1: Update name fields
    try {
      console.log('\n🧪 Test 1: Update first and last name');
      const nameResponse = await api.put('/profile', {
        first_name: 'TestFirst',
        last_name: 'TestLast'
      });
      
      console.log('✅ Name update response:', nameResponse.data);
    } catch (err) {
      console.error('❌ Name update failed:', err.response?.data || err.message);
    }
    
    // Test 2: Update location
    try {
      console.log('\n🧪 Test 2: Update location');
      const locationResponse = await api.put('/profile', {
        location: {
          latitude: 37.7749,
          longitude: -122.4194
        }
      });
      
      console.log('✅ Location update response:', locationResponse.data);
    } catch (err) {
      console.error('❌ Location update failed:', err.response?.data || err.message);
    }
    
    // Test 3: Update preferences (plural)
    try {
      console.log('\n🧪 Test 3: Update preferences (plural)');
      const preferencesResponse = await api.put('/profile', {
        preferences: {
          notifications: true,
          theme: 'dark',
          privacy: 'public'
        }
      });
      
      console.log('✅ Preferences update response:', preferencesResponse.data);
    } catch (err) {
      console.error('❌ Preferences update failed:', err.response?.data || err.message);
    }
    
    // Test 4: Update preference (singular)
    try {
      console.log('\n🧪 Test 4: Update preference (singular)');
      const preferenceResponse = await api.put('/profile', {
        preference: 'Dating'
      });
      
      console.log('✅ Preference update response:', preferenceResponse.data);
    } catch (err) {
      console.error('❌ Preference update failed:', err.response?.data || err.message);
    }
    
    // Test 5: Combined update
    try {
      console.log('\n🧪 Test 5: Combined update (all fields)');
      const combinedResponse = await api.put('/profile', {
        first_name: 'CombinedFirst',
        last_name: 'CombinedLast',
        location: {
          latitude: 34.0522,
          longitude: -118.2437
        },
        preference: 'Friendship',
        preferences: {
          notifications: false,
          theme: 'light'
        }
      });
      
      console.log('✅ Combined update response:', combinedResponse.data);
    } catch (err) {
      console.error('❌ Combined update failed:', err.response?.data || err.message);
    }
    
    console.log('\n✨ All tests completed!');
    
  } catch (err) {
    console.error('🚨 Error running tests:', err);
  }
}

// Run the tests
testProfileUpdates(); 