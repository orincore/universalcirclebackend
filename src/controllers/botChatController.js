const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/database');
const { generateBotResponse, verifyAndRecoverBotUser } = require('../services/ai/botProfileService');
const logger = require('../utils/logger');
const { info, error, warn } = logger;

/**
 * Send message to bot and get immediate response
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const sendMessageToBot = async (req, res) => {
  try {
    const userId = req.user.id;
    const { botId, message } = req.body;
    
    if (!botId || !message) {
      return res.status(400).json({
        success: false,
        message: 'Bot ID and message content are required'
      });
    }
    
    info(`User ${userId} sending message to bot ${botId}: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    
    // Verify bot exists
    let bot;
    try {
      const { data: botData, error: botError } = await supabase
        .from('users')
        .select('*')
        .eq('id', botId)
        .eq('is_bot', true)
        .single();
        
      if (botError || !botData) {
        error(`Bot not found or not a bot user: ${botId}`);
        return res.status(404).json({
          success: false,
          message: 'Bot not found'
        });
      }
      
      bot = botData;
      
      // Also verify/recover bot if needed
      await verifyAndRecoverBotUser(bot);
      info(`Bot verified: ${bot.first_name} ${bot.last_name}`);
      
    } catch (verifyError) {
      error(`Error verifying bot ${botId}: ${verifyError.message}`);
      // Continue anyway since we have the bot data
    }
    
    // Store user message
    const userMessageId = uuidv4();
    const now = new Date().toISOString();
    
    try {
      await supabase
        .from('messages')
        .insert({
          id: userMessageId,
          sender_id: userId,
          receiver_id: botId,
          content: message,
          is_read: true,
          created_at: now,
          updated_at: now
        });
      
      info(`Stored user message ${userMessageId}`);
    } catch (messageError) {
      error(`Error storing user message: ${messageError.message}`);
      // Continue anyway
    }
    
    // Generate bot response
    info(`Generating bot response...`);
    let botResponse;
    let isRateLimited = false;
    
    try {
      botResponse = await generateBotResponse(message, bot, bot.preference || 'Friendship', userId);
      info(`Bot response generated: "${botResponse.substring(0, 100)}${botResponse.length > 100 ? '...' : ''}"`);
    } catch (botError) {
      error(`Error generating bot response: ${botError.message}`);
      
      // Check if this is a rate limit error
      if (botError.message && 
          (botError.message.includes("429") || 
           botError.message.includes("quota") ||
           botError.message.toLowerCase().includes("rate limit"))) {
        
        isRateLimited = true;
        warn(`Rate limit detected for bot ${botId}. Using friendly response.`);
        
        // Use appropriate rate limit response
        const rateLimitResponses = [
          "Our chat server is a bit busy right now. Can we continue in a few minutes?",
          "Just got a notification that I need to wait a moment before responding further. Let's chat again in a bit!",
          "Sorry yaar, too many messages coming in right now. Can we continue this conversation in a few minutes?",
          "I need to step away for a quick break. Let's continue this interesting conversation shortly!",
          "My phone is going crazy with notifications right now. Let me get back to you in a few minutes?"
        ];
        
        botResponse = rateLimitResponses[Math.floor(Math.random() * rateLimitResponses.length)];
      } else {
        // For non-rate limit errors, use a generic response
        botResponse = "Sorry, I couldn't process that message. Can you try again?";
      }
    }
    
    // Return both messages with rate limit flag if applicable
    return res.status(200).json({
      success: true,
      data: {
        userMessage: {
          id: userMessageId,
          senderId: userId,
          receiverId: botId,
          message: message,
          timestamp: now,
          isRead: true
        },
        botMessage: {
          id: uuidv4(), // Just for the response, actual ID is generated in generateBotResponse
          senderId: botId,
          receiverId: userId,
          senderName: `${bot.first_name} ${bot.last_name}`,
          message: botResponse,
          timestamp: new Date().toISOString(),
          isRead: false
        },
        isRateLimited: isRateLimited
      }
    });
  } catch (error) {
    logger.error(`Bot chat error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Server error during bot conversation'
    });
  }
};

/**
 * Get conversation history with bot
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getBotConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { botId } = req.params;
    
    info(`Fetching conversation between user ${userId} and bot ${botId}`);
    
    // Verify bot exists first
    const { data: bot, error: botError } = await supabase
      .from('users')
      .select('id, first_name, last_name, is_bot')
      .eq('id', botId)
      .single();
      
    if (botError || !bot) {
      error(`Bot ${botId} not found`);
      return res.status(404).json({
        success: false,
        message: 'Bot not found'
      });
    }
    
    if (!bot.is_bot) {
      warn(`User ${botId} is not a bot`);
      return res.status(400).json({
        success: false,
        message: 'Specified user is not a bot'
      });
    }
    
    // Get messages between user and bot
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${botId}),and(sender_id.eq.${botId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });
      
    if (error) {
      error(`Error fetching messages: ${error.message}`);
      throw error;
    }
    
    info(`Found ${messages?.length || 0} messages in conversation`);
    
    // Format messages for client
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      senderId: msg.sender_id,
      receiverId: msg.receiver_id,
      message: msg.content,
      timestamp: msg.created_at,
      isRead: msg.is_read
    }));
    
    return res.status(200).json({
      success: true,
      data: formattedMessages
    });
  } catch (err) {
    logger.error(`Error getting bot conversation: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving conversation'
    });
  }
};

module.exports = {
  sendMessageToBot,
  getBotConversation
}; 