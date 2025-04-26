const supabase = require('../config/database');

/**
 * Get overall application statistics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getAppStats = async (req, res) => {
  try {
    // Get total number of users
    const { count: userCount, error: userError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (userError) {
      console.error('Error fetching user count:', userError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user count'
      });
    }

    // Get total number of posts
    const { count: postCount, error: postError } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true });

    if (postError) {
      console.error('Error fetching post count:', postError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch post count'
      });
    }

    // Get total number of messages
    const { count: messageCount, error: messageError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });

    if (messageError) {
      console.error('Error fetching message count:', messageError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch message count'
      });
    }

    // Get total number of matches
    const { count: matchCount, error: matchError } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true });

    if (matchError) {
      console.error('Error fetching match count:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch match count'
      });
    }

    // Get count of accepted matches
    const { count: acceptedMatchCount, error: acceptedMatchError } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted');

    if (acceptedMatchError) {
      console.error('Error fetching accepted match count:', acceptedMatchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch accepted match count'
      });
    }

    // Get top posts by engagement
    const { data: topPosts, error: topPostsError } = await supabase
      .from('posts')
      .select(`
        id,
        caption,
        media_url,
        like_count,
        comment_count,
        share_count,
        created_at,
        user:user_id(
          id,
          first_name,
          last_name,
          username,
          profile_picture_url
        )
      `)
      .order('like_count', { ascending: false })
      .limit(5);

    if (topPostsError) {
      console.error('Error fetching top posts:', topPostsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch top posts'
      });
    }

    // Calculate active users (users who have logged in in the last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: activeUserCount, error: activeUserError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gt('last_login', sevenDaysAgo.toISOString());

    if (activeUserError) {
      console.error('Error fetching active user count:', activeUserError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch active user count'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        users: {
          total: userCount,
          active: activeUserCount
        },
        posts: {
          total: postCount,
          top: topPosts
        },
        messages: {
          total: messageCount
        },
        matches: {
          total: matchCount,
          accepted: acceptedMatchCount,
          successRate: matchCount > 0 ? (acceptedMatchCount / matchCount * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching analytics'
    });
  }
};

/**
 * Get user-specific analytics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's post count
    const { count: postCount, error: postError } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (postError) {
      console.error('Error fetching user post count:', postError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user post count'
      });
    }

    // Get user's message count
    const { count: messagesSentCount, error: messagesSentError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', userId);

    if (messagesSentError) {
      console.error('Error fetching messages sent count:', messagesSentError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch messages sent count'
      });
    }
    
    const { count: messagesReceivedCount, error: messagesReceivedError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', userId);

    if (messagesReceivedError) {
      console.error('Error fetching messages received count:', messagesReceivedError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch messages received count'
      });
    }

    // Get user's match count
    const { count: matchCount, error: matchError } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (matchError) {
      console.error('Error fetching user match count:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user match count'
      });
    }

    // Get user's accepted match count
    const { count: acceptedMatchCount, error: acceptedMatchError } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq('status', 'accepted');

    if (acceptedMatchError) {
      console.error('Error fetching user accepted match count:', acceptedMatchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user accepted match count'
      });
    }

    // Get user's top post
    const { data: topPost, error: topPostError } = await supabase
      .from('posts')
      .select(`
        id,
        caption,
        media_url,
        like_count,
        comment_count,
        share_count,
        created_at
      `)
      .eq('user_id', userId)
      .order('like_count', { ascending: false })
      .limit(1)
      .single();

    if (topPostError && topPostError.code !== 'PGRST116') { // PGRST116 is "no rows returned" which is fine
      console.error('Error fetching user top post:', topPostError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user top post'
      });
    }

    // Get total likes received on all posts
    const { data: totalLikesResult, error: totalLikesError } = await supabase.rpc(
      'get_total_likes_for_user',
      { user_id: userId }
    );

    let totalLikes = 0;
    if (totalLikesError) {
      console.error('Error fetching total likes:', totalLikesError);
      // Continue without this data
    } else if (totalLikesResult) {
      totalLikes = totalLikesResult;
    }

    return res.status(200).json({
      success: true,
      data: {
        posts: {
          total: postCount,
          topPost: topPost || null,
          totalLikes
        },
        messages: {
          sent: messagesSentCount,
          received: messagesReceivedCount,
          total: messagesSentCount + messagesReceivedCount
        },
        matches: {
          total: matchCount,
          accepted: acceptedMatchCount,
          successRate: matchCount > 0 ? (acceptedMatchCount / matchCount * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    console.error('User analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user analytics'
    });
  }
};

module.exports = {
  getAppStats,
  getUserStats
}; 