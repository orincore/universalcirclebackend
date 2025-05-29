/**
 * Example script for deleting a user using the admin API
 * 
 * This script demonstrates how to:
 * 1. Login as an admin user
 * 2. Create an admin client with the JWT token
 * 3. Delete a user with the appropriate options
 * 
 * Usage:
 * node admin-delete-user.js <adminEmail> <adminPassword> <userIdToDelete> [--hard]
 */

const axios = require('axios');
const { createAdminClient } = require('../src/utils/adminClient');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.argv[2];
const ADMIN_PASSWORD = process.argv[3];
const USER_ID_TO_DELETE = process.argv[4];
const HARD_DELETE = process.argv.includes('--hard');

// Check required arguments
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !USER_ID_TO_DELETE) {
  console.error('Error: Missing required arguments');
  console.log('Usage: node admin-delete-user.js <adminEmail> <adminPassword> <userIdToDelete> [--hard]');
  process.exit(1);
}

// Main function
async function deleteUser() {
  try {
    console.log('Authenticating as admin...');

    // 1. Login as admin to get JWT token
    const { data: authResponse } = await axios.post(`${API_URL}/api/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });

    if (!authResponse.success || !authResponse.data.token) {
      console.error('Authentication failed:', authResponse.message || 'Unknown error');
      process.exit(1);
    }

    console.log('Successfully authenticated as admin');
    
    // 2. Create admin client with JWT token
    const adminToken = authResponse.data.token;
    const adminClient = createAdminClient(adminToken, API_URL);

    // 3. First get user details to confirm
    console.log(`Getting details for user ${USER_ID_TO_DELETE}...`);
    const { data: userData } = await adminClient.getUserById(USER_ID_TO_DELETE);
    
    if (!userData.success || !userData.data) {
      console.error('Error fetching user details:', userData.message || 'User not found');
      process.exit(1);
    }

    const user = userData.data;
    console.log(`User found: ${user.username || user.email} (${user.id})`);
    
    // 4. Prompt for confirmation
    if (process.stdin.isTTY) {
      console.log(`\nWARNING: You are about to ${HARD_DELETE ? 'PERMANENTLY' : 'soft'} delete this user`);
      console.log(`Type 'DELETE ${user.username || user.id}' to confirm: `);
      
      const response = await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.once('data', data => {
          process.stdin.pause();
          resolve(data.toString().trim());
        });
      });
      
      if (response !== `DELETE ${user.username || user.id}`) {
        console.log('Deletion cancelled');
        process.exit(0);
      }
    }

    // 5. Delete the user
    console.log(`Deleting user with ${HARD_DELETE ? 'hard' : 'soft'} delete...`);
    const { data: deleteResponse } = await adminClient.deleteUser(USER_ID_TO_DELETE, HARD_DELETE);

    if (!deleteResponse.success) {
      console.error('Error deleting user:', deleteResponse.message);
      process.exit(1);
    }

    console.log(`User successfully ${HARD_DELETE ? 'permanently' : 'soft'} deleted`);
    console.log('Response:', JSON.stringify(deleteResponse, null, 2));

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the script
deleteUser(); 