const supabase = require('../config/database');

/**
 * Delete a specific message (user can only delete their own messages)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteOwnMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Message ID is required'
      });
    }
    
    // Check if the message exists and belongs to the user
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, sender_id')
      .eq('id', messageId)
      .single();
    
    if (messageError || !message) {
      console.error('Error fetching message:', messageError);
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    // Verify ownership - only the sender can delete their message
    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }
    
    // Delete the message
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);
    
    if (deleteError) {
      console.error('Error deleting message:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete message'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteOwnMessage:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Delete all messages in a conversation for the current user
 * This doesn't delete the messages for the other user - it only hides them for the current user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteConversationForUser = async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const userId = req.user.id;
    
    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        message: 'Other user ID is required'
      });
    }
    
    // Check if the conversation exists
    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`);
    
    if (countError) {
      console.error('Error counting messages:', countError);
      return res.status(500).json({
        success: false,
        message: 'Error checking conversation'
      });
    }
    
    if (count === 0) {
      return res.status(404).json({
        success: false,
        message: 'No conversation found with this user'
      });
    }
    
    // Instead of deleting the messages, mark them as deleted for this user
    // First, mark messages sent by the user
    const { error: updateSentError } = await supabase
      .from('messages')
      .update({ deleted_by_sender: true })
      .eq('sender_id', userId)
      .eq('receiver_id', otherUserId);
    
    if (updateSentError) {
      console.error('Error marking sent messages as deleted:', updateSentError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete conversation (sent messages)'
      });
    }
    
    // Then, mark messages received by the user
    const { error: updateReceivedError } = await supabase
      .from('messages')
      .update({ deleted_by_receiver: true })
      .eq('sender_id', otherUserId)
      .eq('receiver_id', userId);
    
    if (updateReceivedError) {
      console.error('Error marking received messages as deleted:', updateReceivedError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete conversation (received messages)'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully for you'
    });
  } catch (error) {
    console.error('Error in deleteConversationForUser:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Permanently delete messages from both sides (only if both users have deleted the conversation)
 * This function should be scheduled to run periodically
 */
const cleanupDeletedMessages = async () => {
  try {
    // Delete messages that have been marked as deleted by both sender and receiver
    const { data, error } = await supabase
      .from('messages')
      .delete()
      .eq('deleted_by_sender', true)
      .eq('deleted_by_receiver', true)
      .select();
    
    if (error) {
      console.error('Error cleaning up deleted messages:', error);
      return;
    }
    
    console.log(`Cleaned up ${data.length} deleted messages`);
  } catch (error) {
    console.error('Error in cleanupDeletedMessages:', error);
  }
};

module.exports = {
  deleteOwnMessage,
  deleteConversationForUser,
  cleanupDeletedMessages
}; 