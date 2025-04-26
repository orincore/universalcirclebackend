const express = require('express');
const router = express.Router();
const { 
  startMatchmaking,
  cancelMatchmaking,
  respondToMatch,
  getPendingMatches
} = require('../controllers/matchmakingController');
const { authenticate } = require('../middlewares/auth');

// All matchmaking routes require authentication
router.use(authenticate);

// Start matchmaking
router.post('/start', startMatchmaking);

// Cancel matchmaking
router.post('/cancel', cancelMatchmaking);

// Respond to a match
router.post('/respond', respondToMatch);

// Get pending matches
router.get('/pending', getPendingMatches);

module.exports = router; 