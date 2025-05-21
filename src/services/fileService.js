const supabase = require('../config/database');
const { error, info } = require('../utils/logger');

/**
 * Upload a file to storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filePath - Path where the file will be stored
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<object>} - Result object with success status and details
 */
const uploadFile = async (fileBuffer, filePath, contentType) => {
  try {
    const { data, error: uploadError } = await supabase.storage
      .from('user-uploads')
      .upload(filePath, fileBuffer, {
        contentType,
        upsert: false
      });

    if (uploadError) {
      error(`Error uploading file: ${uploadError.message}`);
      return {
        success: false,
        error: uploadError.message
      };
    }

    info(`File uploaded successfully: ${filePath}`);
    return {
      success: true,
      path: filePath,
      data
    };
  } catch (err) {
    error(`Exception in uploadFile: ${err.message}`);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * Delete a file from storage
 * @param {string} filePath - Path of the file to delete
 * @returns {Promise<object>} - Result object with success status
 */
const deleteFile = async (filePath) => {
  try {
    const { error: deleteError } = await supabase.storage
      .from('user-uploads')
      .remove([filePath]);

    if (deleteError) {
      error(`Error deleting file: ${deleteError.message}`);
      return {
        success: false,
        error: deleteError.message
      };
    }

    info(`File deleted successfully: ${filePath}`);
    return {
      success: true
    };
  } catch (err) {
    error(`Exception in deleteFile: ${err.message}`);
    return {
      success: false,
      error: err.message
    };
  }
};

/**
 * Generate a signed URL for a file
 * @param {string} filePath - Path of the file
 * @param {number} expiresIn - URL expiration time in seconds (default: 3600)
 * @returns {Promise<string>} - Signed URL
 */
const generateSignedUrl = async (filePath, expiresIn = 3600) => {
  try {
    const { data, error: urlError } = await supabase.storage
      .from('user-uploads')
      .createSignedUrl(filePath, expiresIn);

    if (urlError) {
      error(`Error generating signed URL: ${urlError.message}`);
      throw new Error(urlError.message);
    }

    return data.signedUrl;
  } catch (err) {
    error(`Exception in generateSignedUrl: ${err.message}`);
    throw err;
  }
};

/**
 * List files in a directory
 * @param {string} directory - Directory path
 * @returns {Promise<Array>} - Array of file objects
 */
const listFiles = async (directory) => {
  try {
    const { data, error: listError } = await supabase.storage
      .from('user-uploads')
      .list(directory);

    if (listError) {
      error(`Error listing files: ${listError.message}`);
      throw new Error(listError.message);
    }

    return data;
  } catch (err) {
    error(`Exception in listFiles: ${err.message}`);
    throw err;
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  generateSignedUrl,
  listFiles
}; 