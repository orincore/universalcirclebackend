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
const { activeMatches, matchmakingPool } = require('../socket/socketManager');

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

// Get active matches - used by client to check current match status
router.get('/active', (req, res) => {
  try {
    const userId = req.user.id;
    const userMatches = [];
    
    // Check for matches in activeMatches Map
    for (const [matchId, matchData] of activeMatches.entries()) {
      if (matchData.users.includes(userId)) {
        // Get the other user ID
        const otherUserId = matchData.users.find(id => id !== userId);
        
        userMatches.push({
          matchId,
          otherUserId,
          status: 'pending',
          sharedInterests: matchData.sharedInterests || [],
          createdAt: matchData.createdAt.toISOString(),
          userAccepted: matchData.acceptances[userId] === true,
          otherUserAccepted: matchData.acceptances[otherUserId] === true
        });
      }
    }
    
    // Check if user is in matchmaking pool
    const isInMatchmakingPool = matchmakingPool.has(userId);
    
    return res.status(200).json({
      success: true,
      data: {
        activeMatches: userMatches,
        isInMatchmakingPool,
        joinedPoolAt: isInMatchmakingPool ? matchmakingPool.get(userId).joinedAt.toISOString() : null
      }
    });
  } catch (error) {
    console.error('Error getting active matches:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching active matches'
    });
  }
});

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