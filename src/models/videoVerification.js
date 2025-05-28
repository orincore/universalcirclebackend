const Joi = require('joi');

// Schema for video verification upload request
const videoVerificationSchema = Joi.object({
  // Pre-signed URL key returned from the upload URL endpoint
  videoKey: Joi.string()
    .required()
    .messages({
      'any.required': 'Video key is required',
      'string.empty': 'Video key cannot be empty'
    })
});

// Schema for getting a pre-signed URL for video upload
const videoUploadUrlSchema = Joi.object({
  // Optional content type (defaults to video/mp4)
  contentType: Joi.string()
    .default('video/mp4')
    .valid('video/mp4', 'video/webm', 'video/quicktime')
    .messages({
      'any.only': 'Content type must be one of: video/mp4, video/webm, video/quicktime'
    })
});

// Schema for video verification status response
const verificationStatusSchema = Joi.object({
  id: Joi.string().uuid().required(),
  user_id: Joi.string().uuid().required(),
  status: Joi.string().valid('pending', 'verified', 'rejected').required(),
  face_match_score: Joi.number().allow(null),
  liveness_score: Joi.number().allow(null),
  rejection_reason: Joi.string().allow(null),
  created_at: Joi.date().iso().required(),
  updated_at: Joi.date().iso().required(),
  verified_at: Joi.date().iso().allow(null)
});

module.exports = {
  videoVerificationSchema,
  videoUploadUrlSchema,
  verificationStatusSchema
}; 