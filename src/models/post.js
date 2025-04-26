const Joi = require('joi');

/**
 * Post creation validation schema
 */
const postCreateSchema = Joi.object({
  caption: Joi.string().max(2000).allow('', null),
  mediaType: Joi.string().valid('image', 'video').required(),
  location: Joi.object({
    latitude: Joi.number(),
    longitude: Joi.number(),
    name: Joi.string()
  }).allow(null),
  tags: Joi.array().items(Joi.string()).max(20).default([])
});

/**
 * Post update validation schema
 */
const postUpdateSchema = Joi.object({
  caption: Joi.string().max(2000).allow('', null),
  location: Joi.object({
    latitude: Joi.number(),
    longitude: Joi.number(),
    name: Joi.string()
  }).allow(null),
  tags: Joi.array().items(Joi.string()).max(20)
});

/**
 * Post media upload validation schema
 */
const postMediaSchema = Joi.object({
  mediaType: Joi.string().valid('image', 'video').required(),
  contentType: Joi.string().required()
});

/**
 * Post comment creation validation schema
 */
const commentCreateSchema = Joi.object({
  content: Joi.string().min(1).max(500).required()
});

/**
 * Post reaction validation schema
 */
const reactionSchema = Joi.object({
  type: Joi.string().valid('like', 'love', 'haha', 'wow', 'sad', 'angry').required()
});

module.exports = {
  postCreateSchema,
  postUpdateSchema,
  postMediaSchema,
  commentCreateSchema,
  reactionSchema
}; 