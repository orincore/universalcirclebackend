const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { authenticate } = require('../middlewares/auth');

// Public routes
// None for games - all require authentication

// Authenticated routes
router.use(authenticate);

// Get all available game types
router.get('/available', gameController.getAvailableGames);

// Get active games in a conversation
router.get('/conversation/:conversationId', gameController.getActiveGamesByConversation);

// Get game instance details
router.get('/:gameInstanceId', gameController.getGameInstance);

// Create a new game instance
router.post('/create', gameController.createGame);

// Accept a game invitation
router.post('/:gameInstanceId/accept', gameController.acceptGame);

// Make a move in a game
router.post('/:gameInstanceId/move', gameController.makeMove);

module.exports = router; 