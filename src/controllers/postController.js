const supabase = require('../config/database');
const { 
  postCreateSchema, 
  postUpdateSchema, 
  postMediaSchema,
  commentCreateSchema,
  reactionSchema
} = require('../models/post');
const { generateUploadUrl } = require('../utils/awsS3');

/**
 * Create a new post
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const createPost = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = postCreateSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const userId = req.user.id;
    const { caption, mediaType, location, tags } = value;
    
    // Media URL should be provided in a separate step after upload
    const { mediaUrl } = req.body;
    
    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        message: 'Media URL is required'
      });
    }

    // Create post in database
    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        caption,
        media_url: mediaUrl,
        media_type: mediaType,
        location,
        tags,
        like_count: 0,
        comment_count: 0,
        share_count: 0,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        )
      `)
      .single();

    if (postError) {
      console.error('Error creating post:', postError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create post'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: {
        post
      }
    });
  } catch (error) {
    console.error('Create post error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during post creation'
    });
  }
};

/**
 * Get user's feed posts
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getFeed = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0 } = req.query;

    // Get current user's interests
    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('interests')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('Error fetching user interests:', userError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user data'
      });
    }

    // Get users with similar interests to follow
    const { data: similarUsers, error: similarError } = await supabase
      .rpc('get_users_with_similar_interests', { 
        user_id: userId,
        min_shared_interests: 2,
        max_users: 50
      });

    if (similarError) {
      console.error('Error finding similar users:', similarError);
      // Continue with empty array if error
      similarUsers = [];
    }

    // Get IDs of users to include in feed
    const followingIds = similarUsers.map(user => user.id);
    if (!followingIds.includes(userId)) {
      followingIds.push(userId); // Include current user's posts
    }

    // Get feed posts
    const { data: posts, error: postsError, count } = await supabase
      .from('posts')
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        ),
        user_reaction:reactions!inner(type)
      `, { count: 'exact' })
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (postsError) {
      console.error('Error fetching feed posts:', postsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch feed posts'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        posts,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: count > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get feed error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching feed'
    });
  }
};

/**
 * Get user's posts
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const currentUserId = req.user.id;

    // Get user posts
    const { data: posts, error: postsError, count } = await supabase
      .from('posts')
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        ),
        user_reaction:reactions!inner(type)
      `, { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (postsError) {
      console.error('Error fetching user posts:', postsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user posts'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        posts,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: count > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user posts'
    });
  }
};

/**
 * Get a single post by ID
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    // Get post
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        ),
        reactions(
          id,
          user_id,
          type,
          created_at
        )
      `)
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get user's reaction to this post
    const userReaction = post.reactions.find(r => r.user_id === userId);
    post.userReaction = userReaction ? userReaction.type : null;

    // Remove reactions array to reduce response size
    delete post.reactions;

    return res.status(200).json({
      success: true,
      data: {
        post
      }
    });
  } catch (error) {
    console.error('Get post error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching post'
    });
  }
};

/**
 * Get pre-signed URL for post media upload
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getPostMediaUploadUrl = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = postMediaSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { mediaType, contentType } = value;
    const userId = req.user.id;

    // Validate content type based on media type
    if (mediaType === 'image' && !contentType.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Content type must be an image format for image posts'
      });
    }

    if (mediaType === 'video' && !contentType.startsWith('video/')) {
      return res.status(400).json({
        success: false,
        message: 'Content type must be a video format for video posts'
      });
    }

    // Generate a unique key for the file
    const key = `posts/${userId}/${Date.now()}.${contentType.split('/')[1] || 'file'}`;
    
    // Generate a pre-signed URL for uploading
    const uploadUrl = await generateUploadUrl(key, contentType, 600); // 10 min expiry

    return res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        key,
        mediaUrl: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
      }
    });
  } catch (error) {
    console.error('Error generating media upload URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL'
    });
  }
};

/**
 * Add a comment to a post
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    // Validate request body
    const { error, value } = commentCreateSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { content } = value;

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, user_id, comment_count')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Create comment in database
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        user_id: userId,
        content,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        )
      `)
      .single();

    if (commentError) {
      console.error('Error creating comment:', commentError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create comment'
      });
    }

    // Increment comment count on post
    await supabase
      .from('posts')
      .update({
        comment_count: post.comment_count + 1,
        updated_at: new Date()
      })
      .eq('id', postId);

    return res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        comment
      }
    });
  } catch (error) {
    console.error('Add comment error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while adding comment'
    });
  }
};

/**
 * Get comments for a post
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get comments
    const { data: comments, error: commentsError, count } = await supabase
      .from('comments')
      .select(`
        *,
        user:user_id(
          id, 
          first_name, 
          last_name, 
          username, 
          profile_picture_url
        )
      `, { count: 'exact' })
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (commentsError) {
      console.error('Error fetching comments:', commentsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch comments'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        comments,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: count > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get comments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching comments'
    });
  }
};

/**
 * React to a post
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const reactToPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    // Validate request body
    const { error, value } = reactionSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { type } = value;

    // Check if post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, user_id, like_count')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user already reacted to this post
    const { data: existingReaction, error: reactionError } = await supabase
      .from('reactions')
      .select('id, type')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .single();

    let result;
    let likeCountChange = 0;

    if (existingReaction) {
      // Update existing reaction
      if (existingReaction.type !== type) {
        const { data, error } = await supabase
          .from('reactions')
          .update({
            type,
            updated_at: new Date()
          })
          .eq('id', existingReaction.id)
          .select()
          .single();
        
        result = data;
        
        if (error) {
          console.error('Error updating reaction:', error);
          return res.status(500).json({
            success: false,
            message: 'Failed to update reaction'
          });
        }
      } else {
        // If same reaction, remove it
        const { error } = await supabase
          .from('reactions')
          .delete()
          .eq('id', existingReaction.id);
        
        if (error) {
          console.error('Error removing reaction:', error);
          return res.status(500).json({
            success: false,
            message: 'Failed to remove reaction'
          });
        }
        
        likeCountChange = -1;
        result = null;
      }
    } else {
      // Create new reaction
      const { data, error } = await supabase
        .from('reactions')
        .insert({
          post_id: postId,
          user_id: userId,
          type,
          created_at: new Date(),
          updated_at: new Date()
        })
        .select()
        .single();
      
      result = data;
      likeCountChange = 1;
      
      if (error) {
        console.error('Error creating reaction:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to create reaction'
        });
      }
    }

    // Update like count if needed
    if (likeCountChange !== 0) {
      await supabase
        .from('posts')
        .update({
          like_count: Math.max(0, post.like_count + likeCountChange),
          updated_at: new Date()
        })
        .eq('id', postId);
    }

    return res.status(200).json({
      success: true,
      message: result ? 'Reaction added successfully' : 'Reaction removed successfully',
      data: {
        reaction: result
      }
    });
  } catch (error) {
    console.error('React to post error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while processing reaction'
    });
  }
};

module.exports = {
  createPost,
  getFeed,
  getUserPosts,
  getPost,
  getPostMediaUploadUrl,
  addComment,
  getComments,
  reactToPost
}; 