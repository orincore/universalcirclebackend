const supabase = require('../config/database');
const logger = require('../utils/logger');
const achievementService = require('./achievementService');

// Constants
const GAME_EXPIRE_HOURS = 24; // Games expire after 24 hours of inactivity

/**
 * Get all available game types
 */
const getAvailableGames = async () => {
  try {
    const { data, error } = await supabase
      .from('mini_games')
      .select('*')
      .eq('enabled', true)
      .order('name');
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error(`Error getting available games: ${error.message}`);
    return [];
  }
};

/**
 * Get game by type
 * @param {string} type - Game type
 */
const getGameByType = async (type) => {
  try {
    const { data, error } = await supabase
      .from('mini_games')
      .select('*')
      .eq('type', type)
      .eq('enabled', true)
      .single();
    
    if (error) throw error;
    
    return data;
  } catch (error) {
    logger.error(`Error getting game by type ${type}: ${error.message}`);
    return null;
  }
};

/**
 * Create a new game instance
 * @param {string} gameType - Type of game to create
 * @param {string} conversationId - Conversation ID
 * @param {string} initiatorId - User who initiated the game
 * @param {string} responderId - User who will respond to the game
 */
const createGame = async (gameType, conversationId, initiatorId, responderId) => {
  try {
    // Get game details
    const game = await getGameByType(gameType);
    
    if (!game) {
      return { 
        success: false,
        message: `Game type ${gameType} not found`
      };
    }
    
    // Calculate expiry time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + GAME_EXPIRE_HOURS);
    
    // Initialize game state based on type
    const initialState = generateInitialState(game);
    
    // Create game instance
    const { data, error } = await supabase
      .from('game_instances')
      .insert({
        game_id: game.id,
        conversation_id: conversationId,
        initiator_id: initiatorId,
        responder_id: responderId,
        status: 'pending',
        state: initialState,
        score: { [initiatorId]: 0, [responderId]: 0 },
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return {
      success: true,
      game: {
        ...data,
        gameDetails: game
      }
    };
  } catch (error) {
    logger.error(`Error creating game: ${error.message}`);
    return {
      success: false,
      message: 'Error creating game'
    };
  }
};

/**
 * Generate initial game state based on game type
 * @param {object} game - Game details
 */
const generateInitialState = (game) => {
  const state = {
    currentRound: 1,
    totalRounds: game.rules.rounds || 5,
    currentTurn: null, // Will be set when game is accepted
    gameData: {}
  };
  
  // Game-specific initialization
  switch (game.type) {
    case 'emoji_guess':
      state.gameData = {
        emojiSets: generateEmojiSets(state.totalRounds),
        guessTimeLimit: game.rules.time_limit_seconds || 30
      };
      break;
      
    case 'word_association':
      state.gameData = {
        currentWord: getRandomStartWord(),
        usedWords: [],
        timeLimit: game.rules.time_limit_seconds || 15,
        disallowedWords: game.rules.disallowed_words || []
      };
      break;
      
    case 'truth_or_dare':
      state.gameData = {
        tasks: generateTruthDareTasks(state.totalRounds, 
          game.rules.truth_ratio || 0.6, 
          game.rules.dare_ratio || 0.4)
      };
      break;
      
    case 'trivia':
      state.gameData = {
        questions: generateTriviaQuestions(
          state.totalRounds,
          game.rules.categories || ["general"],
          game.rules.difficulty_levels || ["easy", "medium"]
        )
      };
      break;
      
    case 'two_truths_lie':
      // For this game, no initial data needed as players input their own statements
      state.gameData = {
        statements: {},
        guesses: {}
      };
      break;
      
    default:
      // Generic state for unknown game types
      state.gameData = {};
  }
  
  return state;
};

/**
 * Get active games in a conversation
 * @param {string} conversationId - Conversation ID
 */
const getActiveGamesByConversation = async (conversationId) => {
  try {
    const { data, error } = await supabase
      .from('game_instances')
      .select(`
        *,
        gameDetails:mini_games(*)
      `)
      .eq('conversation_id', conversationId)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    logger.error(`Error getting active games for conversation ${conversationId}: ${error.message}`);
    return [];
  }
};

/**
 * Get game instance by ID
 * @param {string} gameInstanceId - Game instance ID
 */
const getGameInstance = async (gameInstanceId) => {
  try {
    const { data, error } = await supabase
      .from('game_instances')
      .select(`
        *,
        gameDetails:mini_games(*),
        moves:game_moves(*)
      `)
      .eq('id', gameInstanceId)
      .single();
    
    if (error) throw error;
    
    // Sort moves by move number
    if (data.moves) {
      data.moves.sort((a, b) => a.move_number - b.move_number);
    }
    
    return data;
  } catch (error) {
    logger.error(`Error getting game instance ${gameInstanceId}: ${error.message}`);
    return null;
  }
};

/**
 * Accept a game invitation
 * @param {string} gameInstanceId - Game instance ID
 * @param {string} userId - User accepting the game
 */
const acceptGame = async (gameInstanceId, userId) => {
  try {
    // Get game instance
    const gameInstance = await getGameInstance(gameInstanceId);
    
    if (!gameInstance) {
      return {
        success: false,
        message: 'Game not found'
      };
    }
    
    // Check if user is the responder
    if (gameInstance.responder_id !== userId) {
      return {
        success: false,
        message: 'Only the invited user can accept the game'
      };
    }
    
    // Check if game is in pending status
    if (gameInstance.status !== 'pending') {
      return {
        success: false,
        message: `Game is already ${gameInstance.status}`
      };
    }
    
    // Update game state
    const updatedState = {
      ...gameInstance.state,
      currentTurn: determineFirstPlayer(gameInstance.initiator_id, gameInstance.responder_id)
    };
    
    // Update game instance
    const { error } = await supabase
      .from('game_instances')
      .update({
        status: 'active',
        state: updatedState,
        updated_at: new Date().toISOString()
      })
      .eq('id', gameInstanceId);
    
    if (error) throw error;
    
    return {
      success: true,
      message: 'Game accepted',
      gameState: updatedState
    };
  } catch (error) {
    logger.error(`Error accepting game ${gameInstanceId}: ${error.message}`);
    return {
      success: false,
      message: 'Error accepting game'
    };
  }
};

/**
 * Make a move in a game
 * @param {string} gameInstanceId - Game instance ID
 * @param {string} userId - User making the move
 * @param {object} moveData - Move data
 */
const makeMove = async (gameInstanceId, userId, moveData) => {
  try {
    // Get game instance
    const gameInstance = await getGameInstance(gameInstanceId);
    
    if (!gameInstance) {
      return {
        success: false,
        message: 'Game not found'
      };
    }
    
    // Check if game is active
    if (gameInstance.status !== 'active') {
      return {
        success: false,
        message: `Game is ${gameInstance.status}`
      };
    }
    
    // Check if it's user's turn
    if (gameInstance.state.currentTurn !== userId) {
      return {
        success: false,
        message: "It's not your turn"
      };
    }
    
    // Validate move based on game type
    const validationResult = validateMove(gameInstance, userId, moveData);
    
    if (!validationResult.valid) {
      return {
        success: false,
        message: validationResult.message
      };
    }
    
    // Get move number (count existing moves + 1)
    const { data: moveCount, error: countError } = await supabase
      .from('game_moves')
      .select('id', { count: 'exact', head: true })
      .eq('game_instance_id', gameInstanceId);
    
    if (countError) throw countError;
    
    const moveNumber = (moveCount || 0) + 1;
    
    // Record the move
    const { error: moveError } = await supabase
      .from('game_moves')
      .insert({
        game_instance_id: gameInstanceId,
        user_id: userId,
        move_data: moveData,
        move_number: moveNumber,
        created_at: new Date().toISOString()
      });
    
    if (moveError) throw moveError;
    
    // Process move and update game state
    const { newState, newScore, isComplete } = processMove(gameInstance, userId, moveData);
    
    // Update game instance
    const updateData = {
      state: newState,
      score: newScore,
      updated_at: new Date().toISOString()
    };
    
    // If game is complete
    if (isComplete) {
      updateData.status = 'completed';
      updateData.completed_at = new Date().toISOString();
    }
    
    const { error: updateError } = await supabase
      .from('game_instances')
      .update(updateData)
      .eq('id', gameInstanceId);
    
    if (updateError) throw updateError;
    
    // If game is complete, update achievements
    if (isComplete) {
      await processGameCompletion(gameInstance, newScore);
    }
    
    return {
      success: true,
      state: newState,
      score: newScore,
      isComplete
    };
  } catch (error) {
    logger.error(`Error making move in game ${gameInstanceId}: ${error.message}`);
    return {
      success: false,
      message: 'Error making move'
    };
  }
};

/**
 * Process game completion and award achievements
 * @param {object} gameInstance - Game instance
 * @param {object} finalScore - Final game score
 */
const processGameCompletion = async (gameInstance, finalScore) => {
  try {
    // Check mini-game achievement for both users
    await achievementService.checkMiniGameCompletion(gameInstance.initiator_id);
    await achievementService.checkMiniGameCompletion(gameInstance.responder_id);
    
    // Determine winner
    const initiatorScore = finalScore[gameInstance.initiator_id] || 0;
    const responderScore = finalScore[gameInstance.responder_id] || 0;
    
    if (initiatorScore > responderScore) {
      await achievementService.checkMiniGameWin(gameInstance.initiator_id);
    } else if (responderScore > initiatorScore) {
      await achievementService.checkMiniGameWin(gameInstance.responder_id);
    }
    
    logger.info(`Game ${gameInstance.id} completed with scores: ${JSON.stringify(finalScore)}`);
  } catch (error) {
    logger.error(`Error processing game completion: ${error.message}`);
  }
};

/**
 * Validate a move based on game type
 * @param {object} gameInstance - Game instance
 * @param {string} userId - User making the move
 * @param {object} moveData - Move data
 */
const validateMove = (gameInstance, userId, moveData) => {
  // Basic validation - check if move data exists
  if (!moveData) {
    return { valid: false, message: 'No move data provided' };
  }
  
  const gameType = gameInstance.gameDetails.type;
  
  switch (gameType) {
    case 'emoji_guess':
      // Validate emoji guess
      if (!moveData.guess) {
        return { valid: false, message: 'Guess is required' };
      }
      break;
      
    case 'word_association':
      // Validate word
      if (!moveData.word) {
        return { valid: false, message: 'Word is required' };
      }
      
      // Check if word is in disallowed list
      if (gameInstance.state.gameData.disallowedWords.includes(moveData.word.toLowerCase())) {
        return { valid: false, message: 'Word is not allowed' };
      }
      
      // Check if word has been used already
      if (gameInstance.state.gameData.usedWords.includes(moveData.word.toLowerCase())) {
        return { valid: false, message: 'Word has already been used' };
      }
      break;
      
    case 'truth_or_dare':
      // Validate truth or dare response
      if (moveData.type !== 'truth' && moveData.type !== 'dare') {
        return { valid: false, message: 'Invalid response type' };
      }
      
      if (!moveData.response) {
        return { valid: false, message: 'Response is required' };
      }
      break;
      
    case 'trivia':
      // Validate answer
      if (moveData.answer === undefined) {
        return { valid: false, message: 'Answer is required' };
      }
      break;
      
    case 'two_truths_lie':
      // Validate statements or guess
      if (gameInstance.state.currentRound <= 2) {
        // First two rounds are for submitting statements
        if (!Array.isArray(moveData.statements) || moveData.statements.length !== 3) {
          return { valid: false, message: 'Three statements are required' };
        }
      } else {
        // Last round is for guesses
        if (moveData.guess === undefined || moveData.guess < 0 || moveData.guess > 2) {
          return { valid: false, message: 'Valid guess is required (0-2)' };
        }
      }
      break;
      
    default:
      // Generic validation for unknown game types
      return { valid: true };
  }
  
  return { valid: true };
};

/**
 * Process a move and update game state
 * @param {object} gameInstance - Game instance
 * @param {string} userId - User making the move
 * @param {object} moveData - Move data
 */
const processMove = (gameInstance, userId, moveData) => {
  const currentState = gameInstance.state;
  const currentScore = gameInstance.score;
  
  // Create copies to modify
  const newState = JSON.parse(JSON.stringify(currentState));
  const newScore = JSON.parse(JSON.stringify(currentScore));
  
  // Get opponent ID
  const opponentId = userId === gameInstance.initiator_id 
    ? gameInstance.responder_id 
    : gameInstance.initiator_id;
  
  // Initialize scores if they don't exist
  if (!newScore[userId]) newScore[userId] = 0;
  if (!newScore[opponentId]) newScore[opponentId] = 0;
  
  // Process based on game type
  const gameType = gameInstance.gameDetails.type;
  let isComplete = false;
  
  switch (gameType) {
    case 'emoji_guess':
      // Process emoji guess
      const currentEmoji = newState.gameData.emojiSets[newState.currentRound - 1];
      
      // Check if guess is correct (case insensitive partial match)
      const isCorrect = currentEmoji.meaning.toLowerCase()
        .includes(moveData.guess.toLowerCase());
      
      // Award points
      if (isCorrect) {
        newScore[userId] += gameInstance.gameDetails.rules.points_correct || 10;
        
        // Add time bonus if applicable
        if (moveData.timeRemaining && moveData.timeRemaining > 0) {
          newScore[userId] += gameInstance.gameDetails.rules.points_fast_bonus || 5;
        }
      }
      
      // Move to next round or complete game
      if (newState.currentRound >= newState.totalRounds) {
        isComplete = true;
      } else {
        newState.currentRound += 1;
        newState.currentTurn = opponentId;
      }
      break;
      
    case 'word_association':
      // Process word association
      newState.gameData.usedWords.push(moveData.word.toLowerCase());
      newState.gameData.currentWord = moveData.word;
      
      // Award points
      newScore[userId] += gameInstance.gameDetails.rules.points_per_word || 5;
      
      // Move to next round or complete game
      if (newState.currentRound >= newState.totalRounds) {
        isComplete = true;
      } else {
        newState.currentRound += 1;
        newState.currentTurn = opponentId;
      }
      break;
      
    case 'truth_or_dare':
      // Process truth or dare
      
      // Award points for completion
      newScore[userId] += gameInstance.gameDetails.rules.points_per_completion || 10;
      
      // Move to next round or complete game
      if (newState.currentRound >= newState.totalRounds) {
        isComplete = true;
      } else {
        newState.currentRound += 1;
        newState.currentTurn = opponentId;
      }
      break;
      
    case 'trivia':
      // Process trivia answer
      const currentQuestion = newState.gameData.questions[newState.currentRound - 1];
      
      // Check if answer is correct
      const isAnswerCorrect = moveData.answer === currentQuestion.correctAnswer;
      
      // Award points based on difficulty
      if (isAnswerCorrect) {
        switch (currentQuestion.difficulty) {
          case 'easy':
            newScore[userId] += gameInstance.gameDetails.rules.points_easy || 5;
            break;
          case 'medium':
            newScore[userId] += gameInstance.gameDetails.rules.points_medium || 10;
            break;
          case 'hard':
            newScore[userId] += gameInstance.gameDetails.rules.points_hard || 15;
            break;
        }
      }
      
      // Move to next round or complete game
      if (newState.currentRound >= newState.totalRounds) {
        isComplete = true;
      } else {
        newState.currentRound += 1;
        newState.currentTurn = opponentId;
      }
      break;
      
    case 'two_truths_lie':
      // Process two truths and a lie
      if (newState.currentRound <= 2) {
        // First two rounds are for submitting statements
        newState.gameData.statements[userId] = moveData.statements;
        newState.gameData.truth_index = moveData.truth_index;
        
        // Move to next player's submission or to guessing phase
        if (newState.currentRound === 1) {
          newState.currentRound += 1;
          newState.currentTurn = opponentId;
        } else {
          newState.currentRound += 1;
          // First player guesses second player's statements
          newState.currentTurn = gameInstance.initiator_id;
        }
      } else {
        // Record guess
        newState.gameData.guesses[userId] = moveData.guess;
        
        // Check if guess is correct
        const targetStatements = newState.gameData.statements[opponentId];
        const lieIndex = targetStatements.findIndex(s => !s.isTrue);
        
        if (moveData.guess === lieIndex) {
          // Award points for correct guess
          newScore[userId] += gameInstance.gameDetails.rules.points_correct_guess || 10;
        } else {
          // Award points for successful deception to the opponent
          newScore[opponentId] += gameInstance.gameDetails.rules.points_successful_deception || 15;
        }
        
        // If both players have guessed, game is complete
        if (Object.keys(newState.gameData.guesses).length === 2) {
          isComplete = true;
        } else {
          // Other player's turn to guess
          newState.currentTurn = opponentId;
        }
      }
      break;
      
    default:
      // Generic processing for unknown game types
      if (newState.currentRound >= newState.totalRounds) {
        isComplete = true;
      } else {
        newState.currentRound += 1;
        newState.currentTurn = opponentId;
      }
  }
  
  return { newState, newScore, isComplete };
};

/**
 * Determine which player goes first
 */
const determineFirstPlayer = (initiatorId, responderId) => {
  // Randomly determine who goes first
  return Math.random() < 0.5 ? initiatorId : responderId;
};

/**
 * Helper functions for generating game content
 */

// Generate emoji sets for guessing
const generateEmojiSets = (count) => {
  const emojiSets = [
    { emojis: '🏃‍♂️💨', meaning: 'Running fast' },
    { emojis: '🧠💭', meaning: 'Thinking' },
    { emojis: '❤️💔', meaning: 'Heartbreak' },
    { emojis: '🌧️☂️', meaning: 'Rainy day' },
    { emojis: '🔥📱', meaning: 'Hot phone' },
    { emojis: '🎭👨‍👩‍👧‍👦', meaning: 'Family drama' },
    { emojis: '🌍✈️', meaning: 'World travel' },
    { emojis: '🍽️👑', meaning: 'Fancy dinner' },
    { emojis: '🎓📚', meaning: 'Graduation' },
    { emojis: '🎂🕯️', meaning: 'Birthday' }
  ];
  
  // Shuffle and take the requested number
  return shuffleArray(emojiSets).slice(0, count);
};

// Generate starting word for word association
const getRandomStartWord = () => {
  const startWords = [
    'beach', 'mountain', 'coffee', 'sunset', 'book', 
    'music', 'journey', 'dream', 'smile', 'garden',
    'ocean', 'star', 'forest', 'laugh', 'dance'
  ];
  
  return startWords[Math.floor(Math.random() * startWords.length)];
};

// Generate truth or dare tasks
const generateTruthDareTasks = (count, truthRatio, dareRatio) => {
  const truths = [
    'What is your biggest fear?',
    'What is your most embarrassing moment?',
    'What is a secret you\'ve never told anyone?',
    'What is your biggest regret?',
    'Who is your celebrity crush?',
    'What is the most childish thing you still do?',
    'What is the worst gift you\'ve ever received?',
    'What is your guilty pleasure?',
    'What is your most unusual talent?',
    'What was your most awkward date?'
  ];
  
  const dares = [
    'Send a selfie with a funny face',
    'Write a short poem about your day',
    'Record a 10-second dance clip',
    'Tell a joke',
    'Share your most recent embarrassing photo',
    'Do an impression of a celebrity',
    'Draw a self-portrait and share it',
    'Sing the chorus of your favorite song',
    'Share your most used emoji and explain why',
    'Invent a new word and use it in a sentence'
  ];
  
  // Calculate number of truths and dares based on ratio
  const truthCount = Math.round(count * truthRatio);
  const dareCount = count - truthCount;
  
  // Shuffle and slice the arrays
  const shuffledTruths = shuffleArray(truths).slice(0, truthCount);
  const shuffledDares = shuffleArray(dares).slice(0, dareCount);
  
  // Combine and shuffle again
  const combined = [
    ...shuffledTruths.map(text => ({ type: 'truth', text })),
    ...shuffledDares.map(text => ({ type: 'dare', text }))
  ];
  
  return shuffleArray(combined);
};

// Generate trivia questions
const generateTriviaQuestions = (count, categories, difficultyLevels) => {
  const questions = [
    {
      category: 'general',
      difficulty: 'easy',
      question: 'What is the capital of France?',
      options: ['London', 'Berlin', 'Paris', 'Madrid'],
      correctAnswer: 2
    },
    {
      category: 'general',
      difficulty: 'easy',
      question: 'Which planet is known as the Red Planet?',
      options: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
      correctAnswer: 1
    },
    {
      category: 'general',
      difficulty: 'medium',
      question: 'Who painted the Mona Lisa?',
      options: ['Vincent van Gogh', 'Pablo Picasso', 'Leonardo da Vinci', 'Michelangelo'],
      correctAnswer: 2
    },
    {
      category: 'science',
      difficulty: 'medium',
      question: 'What is the chemical symbol for gold?',
      options: ['Go', 'Gd', 'Au', 'Ag'],
      correctAnswer: 2
    },
    {
      category: 'science',
      difficulty: 'hard',
      question: 'What is the smallest prime number?',
      options: ['0', '1', '2', '3'],
      correctAnswer: 2
    },
    {
      category: 'entertainment',
      difficulty: 'easy',
      question: 'Who played Iron Man in the Marvel Cinematic Universe?',
      options: ['Chris Evans', 'Robert Downey Jr.', 'Chris Hemsworth', 'Mark Ruffalo'],
      correctAnswer: 1
    },
    {
      category: 'entertainment',
      difficulty: 'medium',
      question: 'Which band released the album "Abbey Road"?',
      options: ['The Rolling Stones', 'Led Zeppelin', 'The Beatles', 'Pink Floyd'],
      correctAnswer: 2
    },
    {
      category: 'history',
      difficulty: 'medium',
      question: 'In which year did World War II end?',
      options: ['1943', '1945', '1947', '1950'],
      correctAnswer: 1
    },
    {
      category: 'history',
      difficulty: 'hard',
      question: 'Who was the first Emperor of Rome?',
      options: ['Julius Caesar', 'Augustus', 'Nero', 'Constantine'],
      correctAnswer: 1
    },
    {
      category: 'geography',
      difficulty: 'easy',
      question: 'What is the largest ocean on Earth?',
      options: ['Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean', 'Pacific Ocean'],
      correctAnswer: 3
    }
  ];
  
  // Filter questions by category and difficulty
  const filteredQuestions = questions.filter(q => 
    categories.includes(q.category) && difficultyLevels.includes(q.difficulty)
  );
  
  // If not enough questions after filtering, add more from other categories
  if (filteredQuestions.length < count) {
    const remainingQuestions = questions.filter(q => 
      !filteredQuestions.includes(q) && difficultyLevels.includes(q.difficulty)
    );
    filteredQuestions.push(...remainingQuestions);
  }
  
  // Shuffle and take requested number
  return shuffleArray(filteredQuestions).slice(0, count);
};

// Helper function to shuffle an array
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

module.exports = {
  getAvailableGames,
  getGameByType,
  createGame,
  getActiveGamesByConversation,
  getGameInstance,
  acceptGame,
  makeMove
}; 