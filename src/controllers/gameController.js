const gameService = require('../services/gameService');
const logger = require('../utils/logger');
const { isValidUUID } = require('../utils/validators');
const supabase = require('../config/database');

/**
 * Get all available game types
 */
const getAvailableGames = async (req, res) => {
  try {
    const games = await gameService.getAvailableGames();
    
    return res.status(200).json({
      success: true,
      games
    });
  } catch (error) {
    logger.error(`Error getting available games: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving available games'
    });
  }
};

/**
 * Get active games in a conversation
 */
const getActiveGamesByConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    if (!isValidUUID(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid conversation ID'
      });
    }
    
    const games = await gameService.getActiveGamesByConversation(conversationId);
    
    return res.status(200).json({
      success: true,
      games
    });
  } catch (error) {
    logger.error(`Error getting active games: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving active games'
    });
  }
};

/**
 * Get game instance details
 */
const getGameInstance = async (req, res) => {
  try {
    const { gameInstanceId } = req.params;
    
    if (!isValidUUID(gameInstanceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid game instance ID'
      });
    }
    
    const game = await gameService.getGameInstance(gameInstanceId);
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      game
    });
  } catch (error) {
    logger.error(`Error getting game instance: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving game instance'
    });
  }
};

/**
 * Create a new game instance
 */
const createGame = async (req, res) => {
  try {
    const { conversationId, gameType, responderId } = req.body;
    const initiatorId = req.userId; // From auth middleware
    
    if (!conversationId || !gameType || !responderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    if (!isValidUUID(conversationId) || !isValidUUID(responderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }
    
    const result = await gameService.createGame(gameType, conversationId, initiatorId, responderId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
    
    // Send a system message to the conversation with game invitation
    try {
      const gameDetails = result.game.gameDetails;
      
      // Create system message with game data
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: initiatorId,
          receiver_id: responderId,
          content: `Invited you to play ${gameDetails.name}`,
          message_type: 'game_invitation',
          metadata: {
            gameInstanceId: result.game.id,
            gameType: gameDetails.type,
            gameName: gameDetails.name,
            gameDescription: gameDetails.description
          },
          created_at: new Date(),
          updated_at: new Date()
        });
      
      if (messageError) {
        logger.error(`Failed to create game invitation message: ${messageError.message}`);
      }
      
      // Notify via socket if available
      if (req.io) {
        req.io.to(responderId).emit('game_invitation', {
          gameInstance: result.game,
          sender: initiatorId
        });
      }
    } catch (messageErr) {
      logger.error(`Error sending game invitation message: ${messageErr.message}`);
      // Don't fail the request if only the message fails
    }
    
    return res.status(201).json({
      success: true,
      game: result.game
    });
  } catch (error) {
    logger.error(`Error creating game: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error creating game'
    });
  }
};

/**
 * Accept a game invitation
 */
const acceptGame = async (req, res) => {
  try {
    const { gameInstanceId } = req.params;
    const userId = req.userId; // From auth middleware
    
    if (!isValidUUID(gameInstanceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid game instance ID'
      });
    }
    
    const result = await gameService.acceptGame(gameInstanceId, userId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
    
    // Get game instance details to send a message
    const gameInstance = await gameService.getGameInstance(gameInstanceId);
    
    if (gameInstance) {
      // Send a system message that the game was accepted
      try {
        // Create system message with game acceptance
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            conversation_id: gameInstance.conversation_id,
            sender_id: userId,
            receiver_id: gameInstance.initiator_id,
            content: `Accepted the invitation to play ${gameInstance.gameDetails.name}`,
            message_type: 'game_accepted',
            metadata: {
              gameInstanceId: gameInstance.id,
              gameType: gameInstance.gameDetails.type,
              gameName: gameInstance.gameDetails.name,
              currentTurn: result.gameState.currentTurn
            },
            created_at: new Date(),
            updated_at: new Date()
          });
        
        if (messageError) {
          logger.error(`Failed to create game acceptance message: ${messageError.message}`);
        }
        
        // Notify via socket if available
        if (req.io) {
          req.io.to(gameInstance.initiator_id).emit('game_accepted', {
            gameInstance: gameInstance,
            acceptedBy: userId,
            gameState: result.gameState
          });
        }
      } catch (messageErr) {
        logger.error(`Error sending game acceptance message: ${messageErr.message}`);
        // Don't fail the request if only the message fails
      }
    }
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Error accepting game: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error accepting game'
    });
  }
};

/**
 * Make a move in a game
 */
const makeMove = async (req, res) => {
  try {
    const { gameInstanceId } = req.params;
    const userId = req.userId; // From auth middleware
    const moveData = req.body;
    
    if (!isValidUUID(gameInstanceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid game instance ID'
      });
    }
    
    // Get game instance before making the move
    const gameInstanceBefore = await gameService.getGameInstance(gameInstanceId);
    if (!gameInstanceBefore) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    // Make the move
    const result = await gameService.makeMove(gameInstanceId, userId, moveData);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
    
    // Get opponent ID
    const opponentId = userId === gameInstanceBefore.initiator_id 
      ? gameInstanceBefore.responder_id 
      : gameInstanceBefore.initiator_id;
    
    // Send a message about the move
    try {
      // Create a message about the move
      const moveMessage = createMoveMessage(
        gameInstanceBefore.gameDetails.type,
        moveData,
        result.isComplete
      );
      
      const metadata = {
        gameInstanceId,
        gameType: gameInstanceBefore.gameDetails.type,
        moveData: moveData,
        isComplete: result.isComplete,
        newState: result.state,
        score: result.score
      };
      
      // Insert the message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: gameInstanceBefore.conversation_id,
          sender_id: userId,
          receiver_id: opponentId,
          content: moveMessage,
          message_type: result.isComplete ? 'game_completed' : 'game_move',
          metadata: metadata,
          created_at: new Date(),
          updated_at: new Date()
        });
      
      if (messageError) {
        logger.error(`Failed to create game move message: ${messageError.message}`);
      }
      
      // Notify via socket if available
      if (req.io) {
        req.io.to(opponentId).emit('game_move', {
          gameInstanceId,
          moveBy: userId,
          moveData,
          newState: result.state,
          score: result.score,
          isComplete: result.isComplete
        });
        
        // If game is complete, send completion event
        if (result.isComplete) {
          const room = gameInstanceBefore.conversation_id;
          req.io.to(room).emit('game_completed', {
            gameInstanceId,
            finalState: result.state,
            finalScore: result.score
          });
        }
      }
    } catch (messageErr) {
      logger.error(`Error sending game move message: ${messageErr.message}`);
      // Don't fail the request if only the message fails
    }
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Error making move: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error making move'
    });
  }
};

/**
 * Create a message describing a game move
 * @param {string} gameType - Type of game
 * @param {object} moveData - Move data
 * @param {boolean} isComplete - Whether the game is complete
 * @returns {string} Message text
 */
const createMoveMessage = (gameType, moveData, isComplete) => {
  if (isComplete) {
    return 'Completed their turn and finished the game';
  }
  
  switch (gameType) {
    case 'emoji_guess':
      return `Guessed: "${moveData.guess}"`;
      
    case 'word_association':
      return `Responded with: "${moveData.word}"`;
      
    case 'truth_or_dare':
      return `Chose ${moveData.type}: "${moveData.response}"`;
      
    case 'trivia':
      return 'Answered the trivia question';
      
    case 'two_truths_lie':
      if (moveData.statements) {
        return 'Submitted their statements';
      } else if (moveData.guess !== undefined) {
        return `Made their guess for the lie`;
      }
      return 'Made their move';
      
    default:
      return 'Made their move';
  }
};

module.exports = {
  getAvailableGames,
  getActiveGamesByConversation,
  getGameInstance,
  createGame,
  acceptGame,
  makeMove
}; 