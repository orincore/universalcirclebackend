const AWS = require('aws-sdk');
require('dotenv').config();

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const bucketName = process.env.AWS_S3_BUCKET;

/**
 * Generate a pre-signed URL for uploading a file to S3
 * @param {string} key - The file key (path in S3)
 * @param {string} contentType - The content type of the file
 * @param {number} expiresIn - URL expiration time in seconds
 * @returns {Promise<string>} - Pre-signed URL
 */
const generateUploadUrl = async (key, contentType, expiresIn = 60) => {
  const params = {
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    Expires: expiresIn
  };

  return s3.getSignedUrlPromise('putObject', params);
};

/**
 * Delete a file from S3
 * @param {string} key - The file key (path in S3)
 * @returns {Promise<AWS.S3.DeleteObjectOutput>}
 */
const deleteFile = async (key) => {
  const params = {
    Bucket: bucketName,
    Key: key
  };

  return s3.deleteObject(params).promise();
};

/**
 * Generate a pre-signed URL for viewing a file
 * @param {string} key - The file key (path in S3)
 * @param {number} expiresIn - URL expiration time in seconds
 * @returns {Promise<string>} - Pre-signed URL
 */
const generateViewUrl = async (key, expiresIn = 3600) => {
  const params = {
    Bucket: bucketName,
    Key: key,
    Expires: expiresIn
  };

  return s3.getSignedUrlPromise('getObject', params);
};

module.exports = {
  generateUploadUrl,
  deleteFile,
  generateViewUrl,
  s3,
  bucketName
}; 