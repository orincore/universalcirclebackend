const supabase = require('../config/database');
const { messageCreateSchema, messageMediaSchema } = require('../models/message');
const { generateUploadUrl } = require('../utils/awsS3');
const { notifyConversationDeleted } = require('../socket/socketManager');

/**
 * Send a message to another user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const sendMessage = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = messageCreateSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { receiverId, content, mediaUrl } = value;
    const senderId = req.user.id;

    // Check if receiver exists
    const { data: receiver, error: receiverError } = await supabase
      .from('users')
      .select('id')
      .eq('id', receiverId)
      .single();

    if (receiverError || !receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Create message in database
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        media_url: mediaUrl || null,
        is_read: false,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (messageError) {
      console.error('Error creating message:', messageError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send message'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        message
      }
    });
  } catch (error) {
    console.error('Message send error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while sending message'
    });
  }
};

/**
 * Get messages between current user and another user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getConversation = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;
    const { limit = 50, before } = req.query;

    let query = supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    // Add pagination if before timestamp is provided
    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching conversation:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch conversation'
      });
    }

    // Update unread messages from other user to read
    await supabase
      .from('messages')
      .update({ is_read: true, updated_at: new Date() })
      .eq('sender_id', userId)
      .eq('receiver_id', currentUserId)
      .eq('is_read', false);

    return res.status(200).json({
      success: true,
      data: {
        messages: messages.reverse() // Return in ascending order
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching conversation'
    });
  }
};

/**
 * Get all conversations for the current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    // First get all accepted matches for the user
    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select(`
        id,
        user1_id,
        user2_id,
        user1:user1_id(id, first_name, last_name, username, profile_picture_url),
        user2:user2_id(id, first_name, last_name, username, profile_picture_url),
        status,
        created_at,
        updated_at,
        accepted_at
      `)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'accepted')
      .order('updated_at', { ascending: false });

    if (matchError) {
      console.error('Error fetching matches for conversations:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch conversations'
      });
    }

    // Get the last message for each match if exists
    const conversations = [];
    
    for (const match of matches) {
      // Determine the other user in the match
      const otherUserId = match.user1_id === userId ? match.user2_id : match.user1_id;
      const otherUser = match.user1_id === userId ? match.user2 : match.user1;
      
      // Get the last message between these users if any
      const { data: lastMessages, error: messageError } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`)
        .order('created_at', { ascending: false })
        .limit(1);
      
      // Get unread message count
      const { count: unreadCount, error: countError } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', otherUserId)
        .eq('receiver_id', userId)
        .eq('is_read', false);
        
      if (messageError || countError) {
        console.error('Error fetching messages for conversation:', messageError || countError);
        continue; // Skip this conversation but don't fail the whole request
      }
      
      // Format conversation data
      const conversation = {
        id: match.id,
        participants: [userId, otherUserId],
        updatedAt: lastMessages && lastMessages.length > 0 
          ? lastMessages[0].created_at 
          : match.updated_at,
        lastMessage: lastMessages && lastMessages.length > 0 
          ? {
              id: lastMessages[0].id,
              content: lastMessages[0].content,
              senderId: lastMessages[0].sender_id,
              receiverId: lastMessages[0].receiver_id,
              createdAt: lastMessages[0].created_at,
              isRead: lastMessages[0].is_read
            }
          : null,
        otherUser: {
          id: otherUser.id,
          firstName: otherUser.first_name,
          lastName: otherUser.last_name,
          username: otherUser.username,
          profilePictureUrl: otherUser.profile_picture_url
        },
        unreadCount: unreadCount || 0
      };
      
      conversations.push(conversation);
    }
    
    // Sort by most recent activity
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return res.status(200).json({
      success: true,
      data: {
        conversations
      }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching conversations'
    });
  }
};

/**
 * Get pre-signed URL for message media upload
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMessageMediaUploadUrl = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = messageMediaSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { receiverId, contentType } = value;
    const senderId = req.user.id;

    // Generate a unique key for the file
    const key = `messages/${senderId}/${receiverId}/${Date.now()}.${contentType.split('/')[1] || 'file'}`;
    
    // Generate a pre-signed URL for uploading
    const uploadUrl = await generateUploadUrl(key, contentType, 300); // 5 min expiry

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        key,
        mediaUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
      }
    });
  } catch (error) {
    console.error('Error generating media upload URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL'
    });
  }
};

/**
 * Delete all messages between current user and another user and remove from chat list
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteConversation = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId } = req.params;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Start a transaction for multiple operations
    const { error: transactionError } = await supabase.rpc('delete_conversation_data', {
      current_user_id: currentUserId,
      other_user_id: userId
    });

    if (transactionError) {
      // If RPC doesn't exist, fall back to multiple separate operations
      console.log('RPC not available, using separate operations');

      // 1. Delete all messages between the two users
      const { error: deleteMessagesError } = await supabase
        .from('messages')
        .delete()
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUserId})`);

      if (deleteMessagesError) {
        console.error('Error deleting messages:', deleteMessagesError);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete messages'
        });
      }

      // 2. Find and update the match to remove from chat list (set status to 'removed')
      const { data: match, error: matchFindError } = await supabase
        .from('matches')
        .select('id, status')
        .or(`and(user1_id.eq.${currentUserId},user2_id.eq.${userId}),and(user1_id.eq.${userId},user2_id.eq.${currentUserId})`)
        .eq('status', 'accepted')
        .single();

      if (matchFindError && matchFindError.code !== 'PGRST116') { // PGRST116 is "Results contain 0 rows"
        console.error('Error finding match:', matchFindError);
        return res.status(500).json({
          success: false,
          message: 'Failed to find match'
        });
      }

      // If match exists, update its status
      if (match) {
        const { error: matchUpdateError } = await supabase
          .from('matches')
          .update({ 
            status: 'removed',
            updated_at: new Date()
          })
          .eq('id', match.id);

        if (matchUpdateError) {
          console.error('Error updating match:', matchUpdateError);
          return res.status(500).json({
            success: false,
            message: 'Failed to update match status'
          });
        }
      }
    }

    // Notify both users about the conversation deletion via socket
    notifyConversationDeleted(currentUserId, userId);

    return res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully'
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting conversation'
    });
  }
};

module.exports = {
  sendMessage,
  getConversation,
  getConversations,
  getMessageMediaUploadUrl,
  deleteConversation
}; 