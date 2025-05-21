/**
 * Validates if a string is a valid UUID
 * @param {string} str - String to validate
 * @returns {boolean} True if valid UUID, false otherwise
 */
const isValidUUID = (str) => {
  if (!str) return false;
  
  // Regular expression for UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Validates if an email address is valid
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email, false otherwise
 */
const isValidEmail = (email) => {
  if (!email) return false;
  
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates if a URL is valid
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL, false otherwise
 */
const isValidURL = (url) => {
  if (!url) return false;
  
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Validates if a phone number is valid
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid phone number, false otherwise
 */
const isValidPhone = (phone) => {
  if (!phone) return false;
  
  // Basic international phone number validation
  // Allows +, spaces, dashes, and parentheses
  const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,3}[-\s.]?[0-9]{4,10}$/;
  return phoneRegex.test(phone);
};

module.exports = {
  isValidUUID,
  isValidEmail,
  isValidURL,
  isValidPhone
}; 