const Joi = require('joi');

/**
 * Message creation validation schema
 */
const messageCreateSchema = Joi.object({
  receiverId: Joi.string().uuid().required(),
  content: Joi.string().trim().min(1).max(2000).required(),
  mediaUrl: Joi.string().uri().allow(null, ''),
  messageType: Joi.string().valid('text', 'image', 'audio', 'video', 'file', 'location', 
    'game_invitation', 'game_accepted', 'game_move', 'game_completed').default('text'),
  metadata: Joi.object().allow(null)
});

/**
 * Message with media validation schema
 */
const messageMediaSchema = Joi.object({
  receiverId: Joi.string().uuid().required(),
  contentType: Joi.string().required()
});

/**
 * Game invitation message validation schema
 */
const gameInvitationSchema = Joi.object({
  receiverId: Joi.string().uuid().required(),
  conversationId: Joi.string().uuid().required(),
  gameType: Joi.string().required()
});

/**
 * Game move validation schema
 */
const gameMoveSchema = Joi.object({
  gameInstanceId: Joi.string().uuid().required(),
  moveData: Joi.object().required()
});

module.exports = {
  messageCreateSchema,
  messageMediaSchema,
  gameInvitationSchema,
  gameMoveSchema
}; 