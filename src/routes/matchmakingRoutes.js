const express = require('express');
const router = express.Router();
const { 
  startMatchmaking,
  cancelMatchmaking,
  respondToMatch,
  getPendingMatches,
  getMatchmakingStats
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

// Get matchmaking stats and health info (admin only)
router.get('/stats', (req, res, next) => {
  // Simple admin check - could be enhanced with proper role checks
  if (req.user.is_admin) {
    return getMatchmakingStats(req, res);
  }
  return res.status(403).json({
    success: false,
    message: 'Admin access required for matchmaking stats'
  });
});

module.exports = router; 
