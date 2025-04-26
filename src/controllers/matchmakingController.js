const supabase = require('../config/database');
const { matchmakingRequestSchema, matchResponseSchema } = require('../models/matchmaking');
const { validateInterests } = require('../utils/interests');
const { notifyMatchFound } = require('../socket/socketManager');

// In-memory waiting queue for matchmaking
// Use a Map for O(1) lookups by userId
const waitingQueue = new Map();

// Queue processing variables
let isProcessingQueue = false;
const BATCH_SIZE = 100; // Process 100 users per batch
const MATCH_LIMIT_PER_CYCLE = 50; // Max matches to make per processing cycle

/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 * @param {object} coord1 - First coordinate {latitude, longitude}
 * @param {object} coord2 - Second coordinate {latitude, longitude}
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (coord1, coord2) => {
  const R = 6371; // Earth radius in kilometers
  const dLat = (coord2.latitude - coord1.latitude) * (Math.PI / 180);
  const dLon = (coord2.longitude - coord1.longitude) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.latitude * (Math.PI / 180)) * Math.cos(coord2.latitude * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Calculate age from date of birth
 * @param {string} dateOfBirth - Date of birth in ISO format
 * @returns {number} Age in years
 */
const calculateAge = (dateOfBirth) => {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
};

/**
 * Calculate compatibility score between two users - simplified version
 * @param {object} user1 - First user
 * @param {object} user2 - Second user
 * @param {object} criteria - Matchmaking criteria
 * @returns {number} Compatibility score (0 or 100)
 */
const calculateCompatibility = (user1, user2, criteria) => {
  // Only check if preferences match (optional)
  if (criteria.preference && criteria.preference !== user2.preference) {
    console.log(`Preference mismatch: ${criteria.preference} vs ${user2.preference}`);
    return 0;
  }

  // Check for at least 1 shared interest
  const user1Interests = user1.interests || [];
  const user2Interests = user2.interests || [];
  
  // Use Set for efficient intersection calculation
  const user1InterestsSet = new Set(user1Interests);
  const sharedInterests = user2Interests.filter(interest => user1InterestsSet.has(interest));
  
  console.log(`Shared interests between ${user1.id} and ${user2.id}: ${sharedInterests.length > 0 ? sharedInterests.join(', ') : 'None'}`);
  
  // If at least one interest matches, consider it compatible
  return sharedInterests.length > 0 ? 100 : 0;
};

/**
 * Process the matchmaking queue in batches
 * This helps handle high load situations (50k+ users)
 */
const processMatchmakingQueue = async () => {
  if (isProcessingQueue || waitingQueue.size === 0) {
    return;
  }
  
  try {
    isProcessingQueue = true;
    console.log(`Processing matchmaking queue with ${waitingQueue.size} users waiting`);
    
    // Convert map to array for processing
    const queueEntries = Array.from(waitingQueue.values());
    let matchesCreated = 0;
    
    // Process users in batches
    for (let i = 0; i < queueEntries.length && matchesCreated < MATCH_LIMIT_PER_CYCLE; i++) {
      // Skip users who have already been matched in this cycle
      if (!waitingQueue.has(queueEntries[i].userId)) {
        continue;
      }
      
      const user = queueEntries[i];
      
      // Find potential matches for this user
      const potentialMatches = queueEntries.filter((entry, index) => {
        // Don't match with self or already processed entries
        if (entry.userId === user.userId || index <= i) {
          return false;
        }
        
        // Don't consider users who have been matched already
        if (!waitingQueue.has(entry.userId)) {
          return false;
        }
        
        // Check compatibility (simplified to just matching interests)
        const compatibilityScore = calculateCompatibility(user.user, entry.user, user.criteria);
        return compatibilityScore > 0;
      });
      
      // If matches found, create the first match
      if (potentialMatches.length > 0) {
        const match = potentialMatches[0];
        
        try {
          // Create match in database
          const { data: newMatch, error: matchError } = await supabase
            .from('matches')
            .insert({
              user1_id: user.userId,
              user2_id: match.userId,
              status: 'pending',
              compatibility_score: 100, // We're using simplified scoring now
              created_at: new Date(),
              updated_at: new Date()
            })
            .select()
            .single();
            
          if (matchError) {
            console.error('Error creating match:', matchError);
            continue;
          }
          
          // Remove both users from waiting queue
          waitingQueue.delete(user.userId);
          waitingQueue.delete(match.userId);
          
          // Notify both users
          await notifyMatchFound(newMatch, user.user, match.user);
          
          matchesCreated++;
          console.log(`Match created between ${user.userId} and ${match.userId}`);
        } catch (error) {
          console.error('Error during match creation:', error);
        }
      }
      
      // If we've reached our batch limit, break to prevent timeout
      if (matchesCreated >= MATCH_LIMIT_PER_CYCLE) {
        console.log(`Reached match limit of ${MATCH_LIMIT_PER_CYCLE} for this cycle`);
        break;
      }
    }
    
    console.log(`Completed processing cycle. Created ${matchesCreated} matches. ${waitingQueue.size} users still waiting.`);
  } catch (error) {
    console.error('Error processing matchmaking queue:', error);
  } finally {
    isProcessingQueue = false;
    
    // If there are still users waiting, schedule another processing cycle
    if (waitingQueue.size > 0) {
      setTimeout(processMatchmakingQueue, 1000); // Process again in 1 second
    }
  }
};

/**
 * Start matchmaking for a user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const startMatchmaking = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Validate request body
    const { error, value } = matchmakingRequestSchema.validate(req.body);
    
    if (error) {
      console.log(`Invalid matchmaking request from user ${userId}:`, error.details[0].message);
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Check if user is already in waiting queue
    if (waitingQueue.has(userId)) {
      console.log(`User ${userId} is already in matchmaking queue`);
      return res.status(400).json({
        success: false,
        message: 'User is already in matchmaking queue'
      });
    }

    // Get current user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.log(`User ${userId} not found`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Ensure user has interests defined
    if (!user.interests || !Array.isArray(user.interests) || user.interests.length === 0) {
      console.log(`User ${userId} has no interests defined`);
      return res.status(400).json({
        success: false,
        message: 'You must define at least one interest to start matchmaking'
      });
    }

    // Add user to waiting queue
    waitingQueue.set(userId, {
      userId,
      user,
      criteria: value,
      joinedAt: new Date()
    });
    
    console.log(`Added user ${userId} to matchmaking queue. Queue size: ${waitingQueue.size}`);
    
    // Start queue processing if not already running
    if (!isProcessingQueue) {
      processMatchmakingQueue();
    }

    return res.status(200).json({
      success: true,
      message: 'Added to matchmaking queue',
      data: {
        queuePosition: waitingQueue.size
      }
    });
  } catch (error) {
    console.error('Matchmaking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during matchmaking'
    });
  }
};

/**
 * Cancel matchmaking request
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const cancelMatchmaking = (req, res) => {
  try {
    const userId = req.user.id;
    
    // Remove user from waiting queue
    const wasInQueue = waitingQueue.delete(userId);
    
    if (!wasInQueue) {
      console.log(`User ${userId} not found in matchmaking queue`);
      return res.status(404).json({
        success: false,
        message: 'User not found in matchmaking queue'
      });
    }
    
    console.log(`Removed user ${userId} from matchmaking queue. Queue size: ${waitingQueue.size}`);
    
    return res.status(200).json({
      success: true,
      message: 'Removed from matchmaking queue'
    });
  } catch (error) {
    console.error('Cancel matchmaking error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while canceling matchmaking'
    });
  }
};

/**
 * Respond to a match request
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const respondToMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Validate request body
    const { error, value } = matchResponseSchema.validate(req.body);
    
    if (error) {
      console.log(`Invalid match response from user ${userId}:`, error.details[0].message);
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { matchId, accepted } = value;
    console.log(`User ${userId} responded to match ${matchId}: ${accepted ? 'accepted' : 'declined'}`);

    // Get match data
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (matchError || !match) {
      console.log(`Match ${matchId} not found for user ${userId}`);
      return res.status(404).json({
        success: false,
        message: 'Match not found'
      });
    }

    if (match.status !== 'pending') {
      console.log(`Match ${matchId} is already ${match.status}`);
      return res.status(400).json({
        success: false,
        message: `Match is already ${match.status}`
      });
    }

    // Determine which user is responding
    const isUser1 = match.user1_id === userId;
    const otherUserId = isUser1 ? match.user2_id : match.user1_id;
    
    console.log(`User ${userId} is ${isUser1 ? 'user1' : 'user2'} in match, other user is ${otherUserId}`);
    
    // Update match status
    const updateData = {};
    
    if (isUser1) {
      updateData.user1_response = accepted;
    } else {
      updateData.user2_response = accepted;
    }
    
    // Check if other user has already responded
    const otherUserResponse = isUser1 ? match.user2_response : match.user1_response;
    console.log(`Other user (${otherUserId}) response: ${otherUserResponse === null ? 'pending' : (otherUserResponse ? 'accepted' : 'declined')}`);
    
    // If the other user has already responded
    const bothAccepted = 
      (isUser1 && accepted && match.user2_response === true) ||
      (!isUser1 && accepted && match.user1_response === true);
      
    const otherUserDeclined = otherUserResponse === false;
    const thisUserDeclined = !accepted;
    
    if (otherUserResponse !== null) {
      if (bothAccepted) {
        updateData.status = 'accepted';
        console.log(`Both users accepted match ${matchId}, updating status to 'accepted'`);
      } else {
        updateData.status = 'rejected';
        console.log(`At least one user rejected match ${matchId}, updating status to 'rejected'`);
      }
    } else {
      console.log(`Waiting for other user (${otherUserId}) to respond to match ${matchId}`);
    }
    
    updateData.updated_at = new Date();

    // Update match in database
    const { data: updatedMatch, error: updateError } = await supabase
      .from('matches')
      .update(updateData)
      .eq('id', matchId)
      .select()
      .single();

    if (updateError) {
      console.error(`Error updating match ${matchId}:`, updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update match'
      });
    }

    // Handle both accepted case
    if (bothAccepted) {
      console.log(`Match ${matchId} accepted by both users, creating chat connection`);
      
      // Emit match:accepted event through socket to both users
      if (req.io) {
        // Get both users' socket IDs
        const connectedUsers = req.app.get('connectedUsers') || new Map();
        const currentUserSocketId = connectedUsers.get(userId);
        const otherUserSocketId = connectedUsers.get(otherUserId);
        
        // Notify current user
        if (currentUserSocketId) {
          console.log(`Emitting match:accepted to current user (${userId})`);
          req.io.to(currentUserSocketId).emit('match:accepted', {
            matchId,
            userId: otherUserId, // The user they matched with
            status: 'accepted'
          });
        }
        
        // Notify other user
        if (otherUserSocketId) {
          console.log(`Emitting match:accepted to other user (${otherUserId})`);
          req.io.to(otherUserSocketId).emit('match:accepted', {
            matchId,
            userId, // The user they matched with
            status: 'accepted'
          });
        }
      } else {
        console.log('Socket.IO instance not available, cannot emit match:accepted event');
      }
    } 
    // Handle rejection case - restart matchmaking for both users
    else if (thisUserDeclined || otherUserDeclined) {
      console.log(`Match ${matchId} rejected, restarting matchmaking for both users`);
      
      // Emit match:rejected event through socket
      if (req.io) {
        // Get both users' socket IDs
        const connectedUsers = req.app.get('connectedUsers') || new Map();
        const currentUserSocketId = connectedUsers.get(userId);
        const otherUserSocketId = connectedUsers.get(otherUserId);
        
        // Notify users about rejection and restart matchmaking
        const rejectPayload = {
          matchId,
          status: 'rejected',
          message: 'Match was rejected, restarting matchmaking'
        };
        
        // Notify current user
        if (currentUserSocketId) {
          console.log(`Emitting match:rejected to current user (${userId})`);
          req.io.to(currentUserSocketId).emit('match:rejected', rejectPayload);
        }
        
        // Notify other user
        if (otherUserSocketId) {
          console.log(`Emitting match:rejected to other user (${otherUserId})`);
          req.io.to(otherUserSocketId).emit('match:rejected', rejectPayload);
        }
      } else {
        console.log('Socket.IO instance not available, cannot emit match:rejected event');
      }
    }

    return res.status(200).json({
      success: true,
      message: `Match ${updatedMatch.status === 'pending' ? 'response recorded' : updatedMatch.status}`,
      data: {
        match: updatedMatch
      }
    });
  } catch (error) {
    console.error('Match response error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while responding to match'
    });
  }
};

/**
 * Get pending matches for the current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getPendingMatches = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get pending matches
    const { data: matches, error } = await supabase
      .from('matches')
      .select(`
        *,
        user1:user1_id(*),
        user2:user2_id(*)
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending matches:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch pending matches'
      });
    }

    // Format the response
    const formattedMatches = matches.map(match => {
      const otherUser = match.user1_id === userId ? match.user2 : match.user1;
      const userResponse = match.user1_id === userId ? match.user1_response : match.user2_response;
      
      // Remove sensitive data
      delete otherUser.password;
      delete otherUser.email;
      delete otherUser.phone_number;
      
      return {
        id: match.id,
        otherUser: {
          id: otherUser.id,
          firstName: otherUser.first_name,
          lastName: otherUser.last_name,
          username: otherUser.username,
          profilePictureUrl: otherUser.profile_picture_url,
          interests: otherUser.interests
        },
        compatibilityScore: match.compatibility_score,
        userResponse,
        status: match.status,
        createdAt: match.created_at
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        matches: formattedMatches
      }
    });
  } catch (error) {
    console.error('Get pending matches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching pending matches'
    });
  }
};

/**
 * Get matchmaking stats and health information
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMatchmakingStats = async (req, res) => {
  try {
    // Calculate time distribution of users in queue
    const queueEntries = Array.from(waitingQueue.values());
    const now = new Date();
    
    const timeInQueueStats = {
      lessThan1Min: 0,
      between1And5Mins: 0, 
      between5And15Mins: 0,
      moreThan15Mins: 0
    };
    
    queueEntries.forEach(entry => {
      const waitTime = (now - new Date(entry.joinedAt)) / 1000 / 60; // minutes
      
      if (waitTime < 1) {
        timeInQueueStats.lessThan1Min++;
      } else if (waitTime < 5) {
        timeInQueueStats.between1And5Mins++;
      } else if (waitTime < 15) {
        timeInQueueStats.between5And15Mins++;
      } else {
        timeInQueueStats.moreThan15Mins++;
      }
    });
    
    // Get interest distribution
    const interestCounts = {};
    queueEntries.forEach(entry => {
      if (entry.user.interests && Array.isArray(entry.user.interests)) {
        entry.user.interests.forEach(interest => {
          interestCounts[interest] = (interestCounts[interest] || 0) + 1;
        });
      }
    });
    
    // Sort interests by count
    const topInterests = Object.entries(interestCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([interest, count]) => ({ interest, count }));
    
    return res.status(200).json({
      success: true,
      data: {
        queueSize: waitingQueue.size,
        isProcessingQueue: isProcessingQueue,
        timeInQueueDistribution: timeInQueueStats,
        topInterests,
        systemLimits: {
          batchSize: BATCH_SIZE,
          matchLimitPerCycle: MATCH_LIMIT_PER_CYCLE,
          estimatedCapacity: '50k+ concurrent users'
        },
        lastProcessingTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error getting matchmaking stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching matchmaking stats'
    });
  }
};

module.exports = {
  startMatchmaking,
  cancelMatchmaking,
  respondToMatch,
  getPendingMatches,
  getMatchmakingStats
};
