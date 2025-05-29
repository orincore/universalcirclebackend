/**
 * Firebase Admin SDK initialization
 * Used for sending push notifications via Firebase Cloud Messaging (FCM)
 */

const admin = require('firebase-admin');
const logger = require('../../utils/logger');

// Initialize Firebase Admin with service account if not already initialized
let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 * 
 * @returns {admin.app.App} Firebase Admin app instance
 */
const initializeFirebaseAdmin = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if we have service account credentials in environment variables
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      logger.info('Firebase Admin SDK initialized successfully with service account from environment variable');
    } 
    // Check if there's a path to a service account file
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      logger.info(`Firebase Admin SDK initialized successfully with service account from path: ${process.env.FIREBASE_SERVICE_ACCOUNT_PATH}`);
    } 
    // Initialize with application default credentials if no service account is provided
    else {
      firebaseApp = admin.initializeApp();
      logger.info('Firebase Admin SDK initialized with application default credentials');
    }

    return firebaseApp;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    throw error;
  }
};

/**
 * Get Firebase Admin Messaging instance
 * 
 * @returns {admin.messaging.Messaging} Firebase messaging instance
 */
const getMessaging = () => {
  const app = initializeFirebaseAdmin();
  return app.messaging();
};

module.exports = {
  initializeFirebaseAdmin,
  getMessaging
}; 