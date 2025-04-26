const supabase = require('../config/database');
const { matchmakingRequestSchema, matchResponseSchema } = require('../models/matchmaking');
const { validateInterests } = require('../utils/interests');
const { notifyMatchFound } = require('../socket/socketManager');
const User = require('../models/user');
const Match = require('../models/match');

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
  console.log(`Calculating compatibility between user ${user1.id} and user ${user2.id}`);
  
  // Log all relevant data for debugging
  console.log(`User 1 (${user1.id}) interests:`, JSON.stringify(user1.interests || []));
  console.log(`User 2 (${user2.id}) interests:`, JSON.stringify(user2.interests || []));
  
  if (criteria.preference) {
    console.log(`User 1 preference criteria: ${criteria.preference}, User 2 preference: ${user2.preference}`);
  }

  // Only check if preferences match (optional)
  if (criteria.preference && criteria.preference !== user2.preference) {
    console.log(`Preference mismatch: ${criteria.preference} vs ${user2.preference}`);
    return 0;
  }

  // Check for at least 1 shared interest
  const user1Interests = user1.interests || [];
  const user2Interests = user2.interests || [];
  
  // Handle both cases: interests as objects with _id/id or as simple ID strings
  const getInterestId = (interest) => {
    if (typeof interest === 'string') return interest;
    if (interest._id) return interest._id.toString();
    if (interest.id) return interest.id.toString();
    return JSON.stringify(interest); // Fallback for unexpected format
  };
  
  const user1InterestIds = user1Interests.map(getInterestId);
  const user2InterestIds = user2Interests.map(getInterestId);
  
  console.log(`User 1 interest IDs: ${user1InterestIds.join(', ')}`);
  console.log(`User 2 interest IDs: ${user2InterestIds.join(', ')}`);
  
  // Use Set for efficient intersection calculation
  const user1InterestsSet = new Set(user1InterestIds);
  const sharedInterests = user2InterestIds.filter(interestId => user1InterestsSet.has(interestId));
  
  console.log(`Shared interests between ${user1.id} and ${user2.id}: ${sharedInterests.length}`);
  console.log(`Shared interest IDs: ${sharedInterests.join(', ')}`);
  
  // If at least one interest matches, consider it compatible
  const score = sharedInterests.length > 0 ? 100 : 0;
  console.log(`Final compatibility score: ${score}`);
  return score;
};

/**
 * Process the matchmaking queue in batches
 * This helps handle high load situations (50k+ users)
 */
const processMatchmakingQueue = async () => {
  console.log("Processing matchmaking queue...");
  try {
    // Get all users in the waiting queue
    const waitingUsers = await User.find({ matchmakingStatus: "waiting" })
      .select('-password')
      .populate('interests');
    
    console.log(`Found ${waitingUsers.length} users in waiting queue`);
    
    // Process users in batches to avoid creating too many connections at once
    // and to give priority to users who have been waiting longer
    for (const user of waitingUsers) {
      console.log(`Processing user ${user.id}`);
      
      // Skip users who have already been matched in this cycle
      if (await User.findById(user.id).then(u => u.matchmakingStatus !== "waiting")) {
        console.log(`User ${user.id} is no longer waiting, skipping`);
        continue;
      }
      
      // Get all other users in waiting status who haven't been matched yet
      const potentialMatches = waitingUsers.filter(potentialMatch => {
        return (
          potentialMatch.id !== user.id &&
          potentialMatch.matchmakingStatus === "waiting"
        );
      });
      
      console.log(`Found ${potentialMatches.length} potential matches for user ${user.id}`);
      
      // Calculate compatibility with all potential matches
      const compatibilityScores = potentialMatches.map(potentialMatch => {
        const compatibility = calculateCompatibility(user, potentialMatch, {
          preference: user.preference,
        });
        
        return {
          user: potentialMatch,
          compatibility,
        };
      });
      
      // Filter out incompatible matches
      const compatibleMatches = compatibilityScores.filter(
        match => match.compatibility > 0
      );
      
      console.log(`Found ${compatibleMatches.length} compatible matches for user ${user.id}`);
      
      if (compatibleMatches.length > 0) {
        // Sort by compatibility (highest first)
        compatibleMatches.sort((a, b) => b.compatibility - a.compatibility);
        
        // Get the best match
        const bestMatch = compatibleMatches[0];
        console.log(`Best match for user ${user.id} is user ${bestMatch.user.id} with compatibility ${bestMatch.compatibility}`);
        
        // Check if the matched user is still available
        const matchedUser = await User.findById(bestMatch.user.id);
        
        if (matchedUser.matchmakingStatus === "waiting") {
          console.log(`Creating match between users ${user.id} and ${matchedUser.id}`);
          
          // Create a match
          const match = new Match({
            users: [user.id, matchedUser.id],
            status: "pending",
            createdAt: new Date(),
            compatibility: bestMatch.compatibility,
          });
          
          await match.save();
          console.log(`Match created with ID: ${match.id}`);
          
          // Update user statuses
          await User.findByIdAndUpdate(user.id, {
            matchmakingStatus: "matched",
            currentMatch: match.id,
          });
          
          await User.findByIdAndUpdate(matchedUser.id, {
            matchmakingStatus: "matched",
            currentMatch: match.id,
          });
          
          console.log(`Updated matchmaking status to "matched" for users ${user.id} and ${matchedUser.id}`);
        } else {
          console.log(`User ${matchedUser.id} is no longer available for matching`);
        }
      } else {
        console.log(`No compatible matches found for user ${user.id}`);
      }
    }
    
    console.log("Matchmaking queue processing completed");
  } catch (error) {
    console.error("Error processing matchmaking queue:", error);
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
          console.log(`Emitting match:connected to current user (${userId})`);
          req.io.to(currentUserSocketId).emit('match:connected', {
            matchId,
            otherUserId, // The user they matched with
            status: 'connected'
          });
        }
        
        // Notify other user
        if (otherUserSocketId) {
          console.log(`Emitting match:connected to other user (${otherUserId})`);
          req.io.to(otherUserSocketId).emit('match:connected', {
            matchId,
            otherUserId: userId, // The user they matched with
            status: 'connected'
          });
        }
      } else {
        console.log('Socket.IO instance not available, cannot emit match:connected event');
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
      
      // Find matching interests
      const userInterests = match.user1_id === userId ? match.user1.interests : match.user2.interests;
      const otherUserInterests = match.user1_id === userId ? match.user2.interests : match.user1.interests;
      const matchingInterests = userInterests.filter(interest => otherUserInterests.includes(interest));
      
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
        matchingInterests,
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
    
    // Get recent match count
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const { count: recentMatchCount, error: matchCountError } = await supabase
      .from('matches')
      .count()
      .gte('created_at', oneDayAgo.toISOString());
      
    if (matchCountError) {
      console.error('Error counting recent matches:', matchCountError);
    }
    
    return res.status(200).json({
      success: true,
      data: {
        queueSize: waitingQueue.size,
        isProcessingQueue: isProcessingQueue,
        timeInQueueDistribution: timeInQueueStats,
        topInterests,
        matchesLast24Hours: recentMatchCount || 0,
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
