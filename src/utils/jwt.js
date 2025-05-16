const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Generate a JWT token for a user
 * @param {object} user - User object with id and other essential info
 * @returns {string} JWT token
 */
const generateToken = (user) => {
  // Only include necessary user data in the token payload
  const payload = {
    userId: user.id,
    email: user.email,
    username: user.username,
    isAdmin: user.is_admin || user.isAdmin || false // Include admin status in token
  };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

/**
 * Verify a JWT token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken
}; 