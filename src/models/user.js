const Joi = require('joi');
const { validateInterests } = require('../utils/interests');

/**
 * Custom Joi validator for interests
 */
const interestValidator = (value, helpers) => {
  if (!Array.isArray(value) || value.length < 1) {
    return helpers.error('array.min', { limit: 1 });
  }
  
  if (!validateInterests(value)) {
    return helpers.error('any.invalid', { value });
  }
  
  return value;
};

/**
 * User registration validation schema
 */
const userRegistrationSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  gender: Joi.string().valid(
    'male', 'female', 'transgender', 'trans', 'non-binary', 
    'nonbinary', 'genderqueer', 'genderfluid', 'agender', 
    'bigender', 'two-spirit', 'third-gender', 'queer', 
    'questioning', 'intersex', 'other'
  ).required(),
  dateOfBirth: Joi.date().iso().required(),
  email: Joi.string().email().required(),
  phoneNumber: Joi.string().pattern(/^\+?[0-9]{10,15}$/).required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).required(),
  preference: Joi.string().valid('Dating', 'Friendship').required(),
  location: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required()
  }).required(),
  interests: Joi.array().custom(interestValidator, 'interests validation').required(),
  bio: Joi.string().max(500)
});

/**
 * User login validation schema
 */
const userLoginSchema = Joi.object({
  emailOrUsername: Joi.string().required(),
  password: Joi.string().required()
});

/**
 * Profile update validation schema
 */
const profileUpdateSchema = Joi.object({
  firstName: Joi.string().min(2).max(50),
  lastName: Joi.string().min(2).max(50),
  gender: Joi.string().valid(
    'male', 'female', 'transgender', 'trans', 'non-binary', 
    'nonbinary', 'genderqueer', 'genderfluid', 'agender', 
    'bigender', 'two-spirit', 'third-gender', 'queer', 
    'questioning', 'intersex', 'other'
  ),
  preference: Joi.string().valid('Dating', 'Friendship'),
  interests: Joi.array().custom(interestValidator, 'interests validation'),
  location: Joi.object({
    latitude: Joi.number(),
    longitude: Joi.number()
  }),
  bio: Joi.string().max(500)
});

/**
 * Change password validation schema
 */
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
  confirmNewPassword: Joi.string().valid(Joi.ref('newPassword')).required()
});

module.exports = {
  userRegistrationSchema,
  userLoginSchema,
  profileUpdateSchema,
  changePasswordSchema
}; 