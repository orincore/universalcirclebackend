const Joi = require('joi');

/**
 * Matchmaking request validation schema
 */
const matchmakingRequestSchema = Joi.object({
  preference: Joi.string().valid('Dating', 'Friendship').required(),
  maxDistance: Joi.number().min(1).max(100).default(50), // in km
  ageRange: Joi.object({
    min: Joi.number().min(18).max(80).default(18),
    max: Joi.number().min(18).max(80).default(80)
  }).default({ min: 18, max: 80 }),
  interests: Joi.array().items(Joi.string()).min(0)
});

/**
 * Match response validation schema
 */
const matchResponseSchema = Joi.object({
  matchId: Joi.string().uuid().required(),
  accepted: Joi.boolean().required()
});

module.exports = {
  matchmakingRequestSchema,
  matchResponseSchema
}; 