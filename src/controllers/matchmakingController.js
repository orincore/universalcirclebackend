const supabase = require('../config/database');
const { matchmakingRequestSchema, matchResponseSchema } = require('../models/matchmaking');
const { validateInterests } = require('../utils/interests');
const { notifyMatchFound } = require('../socket/socketManager');

// In-memory waiting queue for matchmaking
let waitingQueue = [];

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
 * Calculate compatibility score between two users
 * @param {object} user1 - First user
 * @param {object} user2 - Second user
 * @param {object} criteria - Matchmaking criteria
 * @returns {number} Compatibility score (0-100)
 */
const calculateCompatibility = (user1, user2, criteria) => {
  // Check if preferences match
  if (criteria.preference !== user2.preference) {
    return 0;
  }

  // Check if within age range
  const age = calculateAge(user2.date_of_birth);
  if (age < criteria.ageRange.min || age > criteria.ageRange.max) {
    return 0;
  }

  // Check distance
  const distance = calculateDistance(user1.location, user2.location);
  if (distance > criteria.maxDistance) {
    return 0;
  }

  // Calculate interest overlap
  let interestScore = 0;
  if (criteria.interests && criteria.interests.length > 0) {
    const sharedInterests = user2.interests.filter(interest => 
      criteria.interests.includes(interest)
    );
    interestScore = sharedInterests.length / Math.max(criteria.interests.length, 1) * 50;
  } else {
    const sharedInterests = user2.interests.filter(interest => 
      user1.interests.includes(interest)
    );
    interestScore = sharedInterests.length / Math.max(user1.interests.length, 1) * 50;
  }

  // Calculate distance score (closer is better)
  const distanceScore = Math.max(0, 50 - (distance / criteria.maxDistance * 50));

  // Final score is a combination of interest overlap and distance
  return Math.round(interestScore + distanceScore);
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
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    // Check if user is already in waiting queue
    const existingQueueEntry = waitingQueue.find(entry => entry.userId === userId);
    if (existingQueueEntry) {
      return res.status(400).json({
        success: false,
        message: 'User is already in matchmaking queue'
      });
    }

    // Validate interests if provided
    if (value.interests && value.interests.length > 0 && !validateInterests(value.interests)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid interests provided'
      });
    }

    // Get current user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add user to waiting queue
    const queueEntry = {
      userId,
      user,
      criteria: value,
      joinedAt: new Date()
    };
    
    // Find potential matches in existing queue
    const potentialMatches = waitingQueue.filter(entry => {
      // Don't match with self
      if (entry.userId === userId) return false;
      
      // Calculate compatibility in both directions
      const userToMatchScore = calculateCompatibility(user, entry.user, value);
      const matchToUserScore = calculateCompatibility(entry.user, user, entry.criteria);
      
      // Only match if both scores are positive
      return userToMatchScore > 0 && matchToUserScore > 0;
    });

    // Sort by compatibility score and time in queue
    potentialMatches.sort((a, b) => {
      const scoreA = calculateCompatibility(user, a.user, value);
      const scoreB = calculateCompatibility(user, b.user, value);
      
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.joinedAt - b.joinedAt; // Older entries first
    });

    // If no matches found, add to queue and return
    if (potentialMatches.length === 0) {
      waitingQueue.push(queueEntry);
      return res.status(200).json({
        success: true,
        message: 'Added to matchmaking queue',
        data: {
          queuePosition: waitingQueue.length
        }
      });
    }

    // Create a match with the best potential match
    const match = potentialMatches[0];
    
    // Remove matched user from queue
    waitingQueue = waitingQueue.filter(entry => entry.userId !== match.userId);
    
    // Create match in database
    const { data: newMatch, error: matchError } = await supabase
      .from('matches')
      .insert({
        user1_id: userId,
        user2_id: match.userId,
        status: 'pending',
        compatibility_score: calculateCompatibility(user, match.user, value),
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (matchError) {
      console.error('Error creating match:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create match'
      });
    }

    // Notify both users about the match via Socket.IO
    await notifyMatchFound(newMatch, user, match.user);

    return res.status(200).json({
      success: true,
      message: 'Match found',
      data: {
        match: newMatch,
        user: {
          id: match.user.id,
          firstName: match.user.first_name,
          lastName: match.user.last_name,
          username: match.user.username,
          profilePictureUrl: match.user.profile_picture_url,
          interests: match.user.interests
        }
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
    const initialLength = waitingQueue.length;
    waitingQueue = waitingQueue.filter(entry => entry.userId !== userId);
    
    if (waitingQueue.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'User not found in matchmaking queue'
      });
    }
    
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

module.exports = {
  startMatchmaking,
  cancelMatchmaking,
  respondToMatch,
  getPendingMatches
}; 
