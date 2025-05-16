const Joi = require('joi');

/**
 * Validation schema for admin login
 */
const adminLoginSchema = Joi.object({
  emailOrUsername: Joi.string()
    .min(3)
    .max(255)
    .required()
    .messages({
      'string.empty': 'Email or username is required',
      'string.min': 'Email or username must be at least {#limit} characters long',
      'string.max': 'Email or username cannot exceed {#limit} characters',
      'any.required': 'Email or username is required'
    }),
  
  password: Joi.string()
    .min(8)
    .max(255)
    .required()
    .messages({
      'string.empty': 'Password is required',
      'string.min': 'Password must be at least {#limit} characters long',
      'string.max': 'Password cannot exceed {#limit} characters',
      'any.required': 'Password is required'
    })
});

module.exports = {
  adminLoginSchema
}; 