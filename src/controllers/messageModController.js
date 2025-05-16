const supabase = require('../config/database');

/**
 * Submit a report for a user and/or specific messages
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const reportUserMessages = async (req, res) => {
  try {
    const { 
      reportedUserId, 
      messageIds, 
      reason,
      details
    } = req.body;
    const reporterId = req.user.id;
    
    if (!reportedUserId) {
      return res.status(400).json({
        success: false,
        message: 'Reported user ID is required'
      });
    }
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Report reason is required'
      });
    }
    
    // Check if reported user exists
    const { data: reportedUser, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', reportedUserId)
      .single();
    
    if (userError || !reportedUser) {
      console.error('Error finding reported user:', userError);
      return res.status(404).json({
        success: false,
        message: 'Reported user not found'
      });
    }
    
    // Create a report record
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        report_type: messageIds && messageIds.length > 0 ? 'message' : 'user',
        reporter_id: reporterId,
        reported_user_id: reportedUserId,
        reason,
        details,
        status: 'pending',
        created_at: new Date()
      })
      .select()
      .single();
    
    if (reportError) {
      console.error('Error creating report:', reportError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create report'
      });
    }
    
    // If message IDs were provided, link them to the report
    if (messageIds && messageIds.length > 0) {
      const messageReports = messageIds.map(messageId => ({
        report_id: report.id,
        message_id: messageId,
        created_at: new Date()
      }));
      
      const { error: messageReportError } = await supabase
        .from('reported_messages')
        .insert(messageReports);
      
      if (messageReportError) {
        console.error('Error linking messages to report:', messageReportError);
        // Continue even if linking fails
      }
    }
    
    return res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      data: {
        reportId: report.id
      }
    });
  } catch (error) {
    console.error('Error in reportUserMessages:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get reported messages for a specific report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getReportedMessages = async (req, res) => {
  try {
    const { reportId } = req.params;
    
    if (!reportId) {
      return res.status(400).json({
        success: false,
        message: 'Report ID is required'
      });
    }
    
    // Get report details
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select(`
        id,
        report_type,
        reason,
        details,
        status,
        created_at,
        reporter:reporter_id(id, username, profile_picture_url),
        reported_user:reported_user_id(id, username, profile_picture_url)
      `)
      .eq('id', reportId)
      .single();
    
    if (reportError || !report) {
      console.error('Error fetching report:', reportError);
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }
    
    // Get reported messages
    const { data: messageLinks, error: messageLinksError } = await supabase
      .from('reported_messages')
      .select('message_id')
      .eq('report_id', reportId);
    
    if (messageLinksError) {
      console.error('Error fetching reported message links:', messageLinksError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reported message links'
      });
    }
    
    const messageIds = messageLinks.map(link => link.message_id);
    
    if (messageIds.length === 0) {
      // If no specific messages were reported, return just the report
      return res.status(200).json({
        success: true,
        data: {
          report,
          messages: []
        }
      });
    }
    
    // Get message content
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select(`
        id,
        content,
        created_at,
        sender_id,
        receiver_id,
        sender:sender_id(id, username, profile_picture_url),
        receiver:receiver_id(id, username, profile_picture_url)
      `)
      .in('id', messageIds)
      .order('created_at', { ascending: true });
    
    if (messagesError) {
      console.error('Error fetching reported messages:', messagesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch reported messages'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: {
        report,
        messages
      }
    });
  } catch (error) {
    console.error('Error in getReportedMessages:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Delete a specific message (admin function)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reason } = req.body;
    
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Message ID is required'
      });
    }
    
    // Get message info before deletion
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content')
      .eq('id', messageId)
      .single();
    
    if (messageError || !message) {
      console.error('Error fetching message:', messageError);
      return res.status(404).json({
        success: false,
        message: 'Message not found'
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
    
    // Log the deletion for audit purposes
    await supabase.from('admin_actions').insert({
      admin_id: req.user.id,
      action_type: 'delete_message',
      target_id: messageId,
      target_type: 'message',
      reason: reason || 'Violated community guidelines',
      created_at: new Date()
    });
    
    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteMessage:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Delete all messages in a conversation (admin function)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const deleteConversation = async (req, res) => {
  try {
    const { user1Id, user2Id } = req.params;
    const { reason } = req.body;
    
    if (!user1Id || !user2Id) {
      return res.status(400).json({
        success: false,
        message: 'Both user IDs are required'
      });
    }
    
    // Count messages before deletion for confirmation
    const { count, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .or(`and(sender_id.eq.${user1Id},receiver_id.eq.${user2Id}),and(sender_id.eq.${user2Id},receiver_id.eq.${user1Id})`);
    
    if (countError) {
      console.error('Error counting messages:', countError);
      return res.status(500).json({
        success: false,
        message: 'Error counting messages in conversation'
      });
    }
    
    if (count === 0) {
      return res.status(404).json({
        success: false,
        message: 'No messages found between these users'
      });
    }
    
    // Delete all messages between these users
    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .or(`and(sender_id.eq.${user1Id},receiver_id.eq.${user2Id}),and(sender_id.eq.${user2Id},receiver_id.eq.${user1Id})`);
    
    if (deleteError) {
      console.error('Error deleting conversation:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete conversation'
      });
    }
    
    // Log the deletion for audit purposes
    await supabase.from('admin_actions').insert({
      admin_id: req.user.id,
      action_type: 'delete_conversation',
      target_id: `${user1Id}_${user2Id}`,
      target_type: 'conversation',
      additional_data: JSON.stringify({ user1_id: user1Id, user2_id: user2Id }),
      reason: reason || 'Violated community guidelines',
      created_at: new Date()
    });
    
    return res.status(200).json({
      success: true,
      message: `Conversation deleted successfully. ${count} messages removed.`
    });
  } catch (error) {
    console.error('Error in deleteConversation:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  reportUserMessages,
  getReportedMessages,
  deleteMessage,
  deleteConversation
}; 