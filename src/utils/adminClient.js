/**
 * Admin API client utilities
 * 
 * This file provides helper functions to interact with the admin API endpoints
 * All functions require a valid JWT token with admin privileges
 */

const axios = require('axios');

/**
 * Creates an admin API client with proper authentication
 * @param {string} token - JWT token with admin privileges
 * @param {string} baseURL - Base URL for the API (default: current server URL)
 * @returns {object} - Admin client instance
 */
const createAdminClient = (token, baseURL = '') => {
  if (!token) {
    throw new Error('Admin token is required');
  }

  // Create axios instance with authentication header
  const client = axios.create({
    baseURL: `${baseURL}/api/admin`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return {
    /**
     * Get all users with pagination
     * @param {object} options - Query parameters
     * @returns {Promise} - API response
     */
    getAllUsers: (options = {}) => {
      return client.get('/users', { params: options });
    },

    /**
     * Get all users with bulk loading (for admin dashboard)
     * @param {object} options - Query parameters
     * @returns {Promise} - API response
     */
    getAllUsersBulk: (options = {}) => {
      return client.get('/users/bulk', { params: options });
    },

    /**
     * Get user details by ID
     * @param {string} userId - User ID
     * @returns {Promise} - API response
     */
    getUserById: (userId) => {
      return client.get(`/users/${userId}`);
    },

    /**
     * Update user admin status
     * @param {string} userId - User ID
     * @param {boolean} isAdmin - New admin status
     * @returns {Promise} - API response
     */
    updateUserAdminStatus: (userId, isAdmin) => {
      return client.patch(`/users/${userId}/admin`, { isAdmin });
    },

    /**
     * Update user ban status
     * @param {string} userId - User ID
     * @param {boolean} isBanned - New ban status
     * @param {string} reason - Ban reason (optional)
     * @returns {Promise} - API response
     */
    updateUserBanStatus: (userId, isBanned, reason = '') => {
      return client.patch(`/users/${userId}/ban`, { isBanned, reason });
    },

    /**
     * Delete user (soft or hard delete)
     * @param {string} userId - User ID to delete
     * @param {boolean} hardDelete - Whether to perform hard delete (default: false)
     * @returns {Promise} - API response
     */
    deleteUser: (userId, hardDelete = false) => {
      return client.delete(`/users/${userId}`, { 
        params: { hard_delete: hardDelete }
      });
    },

    /**
     * Delete post by ID
     * @param {string} postId - Post ID
     * @param {string} reason - Reason for deletion (optional)
     * @returns {Promise} - API response
     */
    deletePost: (postId, reason = '') => {
      return client.delete(`/moderation/posts/${postId}`, { data: { reason } });
    },

    /**
     * Get system settings
     * @returns {Promise} - API response
     */
    getSystemSettings: () => {
      return client.get('/settings');
    },

    /**
     * Update system settings
     * @param {object} settings - Settings object with key-value pairs
     * @returns {Promise} - API response
     */
    updateSystemSettings: (settings) => {
      return client.patch('/settings', { settings });
    },

    /**
     * Get server health status
     * @returns {Promise} - API response
     */
    getServerHealth: () => {
      return client.get('/system/health');
    },

    /**
     * Get detailed matchmaking statistics
     * @returns {Promise} - API response 
     */
    getMatchmakingStats: () => {
      return client.get('/matchmaking/stats');
    }
  };
};

module.exports = { createAdminClient }; 