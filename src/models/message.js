const Joi = require('joi');

/**
 * Message creation validation schema
 */
const messageCreateSchema = Joi.object({
  receiverId: Joi.string().uuid().required(),
  content: Joi.string().trim().min(1).max(2000).required(),
  mediaUrl: Joi.string().uri().allow(null, '')
});

/**
 * Message with media validation schema
 */
const messageMediaSchema = Joi.object({
  receiverId: Joi.string().uuid().required(),
  contentType: Joi.string().required()
});

module.exports = {
  messageCreateSchema,
  messageMediaSchema
}; 