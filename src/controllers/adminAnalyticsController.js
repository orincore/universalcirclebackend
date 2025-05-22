const supabase = require('../config/database');
const { info, error, warn } = require('../utils/logger');

/**
 * Get total users statistics with growth metrics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getTotalUsers = async (req, res) => {
  try {
    // Get time period from query parameters (default to 30 days)
    const period = req.query.period || '30';
    const periodDays = parseInt(period);
    const periodDate = new Date();
    periodDate.setDate(periodDate.getDate() - periodDays);
    
    // Get total users count
    const { count: totalUsers, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      error('Error fetching total users count:', countError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch total users count'
      });
    }
    
    // Get new users in the selected period
    const { count: newUsers, error: newUsersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodDate.toISOString());
    
    if (newUsersError) {
      error('Error fetching new users count:', newUsersError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch new users count'
      });
    }
    
    // Get user growth by month for the last 12 months
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    
    const { data: monthlyGrowth, error: growthError } = await supabase
      .from('users')
      .select('created_at')
      .gte('created_at', lastYear.toISOString())
      .order('created_at', { ascending: true });
    
    if (growthError) {
      error('Error fetching user growth:', growthError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch user growth data'
      });
    }
    
    // Process monthly growth data
    const monthlyData = processMonthlyGrowth(monthlyGrowth);
    
    // Get user demographics (gender distribution)
    const { data: genderData, error: genderError } = await supabase
      .from('users')
      .select('gender')
      .not('gender', 'is', null);
    
    if (genderError) {
      error('Error fetching gender demographics:', genderError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch gender demographics'
      });
    }
    
    const genderDistribution = processGenderDistribution(genderData);
    
    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        newUsers,
        growthRate: totalUsers > 0 ? ((newUsers / totalUsers) * 100).toFixed(2) : 0,
        period: `${periodDays} days`,
        monthlyGrowth: monthlyData,
        demographics: {
          gender: genderDistribution
        }
      }
    });
  } catch (error) {
    error('Error in getTotalUsers:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching total users statistics'
    });
  }
};

/**
 * Get user activity patterns
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getUserActivity = async (req, res) => {
  try {
    // Get activity time period
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get users who logged in during the period
    const { data: activeUsers, error: activeError } = await supabase
      .from('users')
      .select('id, last_login')
      .gte('last_login', startDate.toISOString());
    
    if (activeError) {
      error('Error fetching active users:', activeError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch active users'
      });
    }
    
    // Get message activity
    const { data: messageActivity, error: messageError } = await supabase
      .from('messages')
      .select('created_at, sender_id')
      .gte('created_at', startDate.toISOString());
    
    if (messageError) {
      error('Error fetching message activity:', messageError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch message activity'
      });
    }
    
    // Get matchmaking activity
    const { data: matchActivity, error: matchError } = await supabase
      .from('matches')
      .select('created_at, updated_at, status')
      .gte('created_at', startDate.toISOString());
    
    if (matchError) {
      error('Error fetching match activity:', matchError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch match activity'
      });
    }
    
    // Process activity data by hour of day and day of week
    const hourlyActivity = processHourlyActivity(activeUsers, messageActivity);
    const dailyActivity = processDailyActivity(activeUsers, messageActivity, matchActivity);
    
    // Calculate engagement metrics
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    const engagementRate = totalUsers > 0 ? ((activeUsers.length / totalUsers) * 100).toFixed(2) : 0;
    
    // Calculate average session time (mock data - would need session tracking in real app)
    const avgSessionTime = '12 minutes';
    
    return res.status(200).json({
      success: true,
      data: {
        activeUsers: activeUsers.length,
        engagementRate,
        avgSessionTime,
        timeDistribution: {
          hourly: hourlyActivity,
          daily: dailyActivity
        },
        activityMetrics: {
          messagesExchanged: messageActivity.length,
          matchesInitiated: matchActivity.length,
          matchesAccepted: matchActivity.filter(m => m.status === 'accepted').length
        }
      }
    });
  } catch (error) {
    error('Error in getUserActivity:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user activity statistics'
    });
  }
};

/**
 * Get daily active users stats
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getDailyActiveUsers = async (req, res) => {
  try {
    // Get time range (default to last 30 days)
    const days = parseInt(req.query.days) || 30;
    
    // Generate daily data for the specified period
    const dailyData = [];
    const endDate = new Date();
    
    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // Query users who logged in on this date
      const { count: dau, error: dauError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('last_login', date.toISOString())
        .lt('last_login', nextDate.toISOString());
      
      if (dauError) {
        error(`Error fetching DAU for ${date.toISOString()}:`, dauError);
        continue;
      }
      
      // Query new users registered on this date
      const { count: newUsers, error: newUsersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', date.toISOString())
        .lt('created_at', nextDate.toISOString());
      
      if (newUsersError) {
        error(`Error fetching new users for ${date.toISOString()}:`, newUsersError);
        continue;
      }
      
      dailyData.push({
        date: date.toISOString().split('T')[0],
        activeUsers: dau,
        newUsers: newUsers
      });
    }
    
    // Calculate average DAU
    const totalDAU = dailyData.reduce((sum, day) => sum + day.activeUsers, 0);
    const avgDAU = dailyData.length > 0 ? Math.round(totalDAU / dailyData.length) : 0;
    
    // Calculate DAU/MAU ratio (as a measure of stickiness)
    const mau = new Set(
      dailyData.flatMap(day => Array(day.activeUsers).fill(day.date))
    ).size;
    
    const stickiness = mau > 0 ? (avgDAU / mau * 100).toFixed(2) : 0;
    
    return res.status(200).json({
      success: true,
      data: {
        dailyActiveUsers: dailyData,
        metrics: {
          averageDAU: avgDAU,
          stickiness: `${stickiness}%`,
          period: `${days} days`,
          trend: calculateTrend(dailyData.map(d => d.activeUsers))
        }
      }
    });
  } catch (error) {
    error('Error in getDailyActiveUsers:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching daily active users'
    });
  }
};

/**
 * Get matches created statistics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMatchesCreated = async (req, res) => {
  try {
    // Get time period (default to last 30 days)
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get all matches in the period
    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select('id, status, created_at, compatibility_score, user1_id, user2_id')
      .gte('created_at', startDate.toISOString());
    
    if (matchesError) {
      error('Error fetching matches:', matchesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch matches'
      });
    }
    
    // Calculate daily match creation
    const dailyMatches = processMatchesByDate(matches);
    
    // Calculate match outcomes
    const matchOutcomes = {
      total: matches.length,
      accepted: matches.filter(m => m.status === 'accepted').length,
      rejected: matches.filter(m => m.status === 'rejected').length,
      pending: matches.filter(m => m.status === 'pending').length,
      expired: matches.filter(m => m.status === 'expired').length
    };
    
    // Calculate match success rate
    const successRate = matchOutcomes.total > 0 
      ? (matchOutcomes.accepted / matchOutcomes.total * 100).toFixed(2)
      : 0;
    
    // Calculate average compatibility score
    const avgScore = matches.length > 0
      ? (matches.reduce((sum, match) => sum + (match.compatibility_score || 0), 0) / matches.length).toFixed(2)
      : 0;
    
    return res.status(200).json({
      success: true,
      data: {
        matches: matchOutcomes,
        successRate: `${successRate}%`,
        avgCompatibilityScore: avgScore,
        dailyMatches,
        period: `${days} days`
      }
    });
  } catch (error) {
    error('Error in getMatchesCreated:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching matches statistics'
    });
  }
};

/**
 * Get message statistics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMessagesSent = async (req, res) => {
  try {
    // Get time period (default to last 30 days)
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get all messages in the period
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, created_at, is_read')
      .gte('created_at', startDate.toISOString());
    
    if (messagesError) {
      error('Error fetching messages:', messagesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch messages'
      });
    }
    
    // Calculate daily message volume
    const dailyMessages = processMessagesByDate(messages);
    
    // Calculate read receipt stats
    const readReceipts = {
      total: messages.length,
      read: messages.filter(m => m.is_read).length,
      unread: messages.filter(m => !m.is_read).length
    };
    
    // Calculate read rate
    const readRate = readReceipts.total > 0 
      ? (readReceipts.read / readReceipts.total * 100).toFixed(2)
      : 0;
    
    // Get unique conversations
    const conversations = new Set();
    messages.forEach(m => {
      const convoId = [m.sender_id, m.receiver_id].sort().join('-');
      conversations.add(convoId);
    });
    
    // Calculate messages per conversation
    const messagesPerConvo = conversations.size > 0 
      ? (messages.length / conversations.size).toFixed(2)
      : 0;
    
    return res.status(200).json({
      success: true,
      data: {
        totalMessages: messages.length,
        readReceipts,
        readRate: `${readRate}%`,
        activeConversations: conversations.size,
        messagesPerConversation: messagesPerConvo,
        dailyMessages,
        period: `${days} days`
      }
    });
  } catch (error) {
    error('Error in getMessagesSent:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching message statistics'
    });
  }
};

/**
 * Get match success rate statistics
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getMatchSuccessRate = async (req, res) => {
  try {
    // Get matches grouped by compatibility score
    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select('status, compatibility_score');
    
    if (matchesError) {
      error('Error fetching match success rate:', matchesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch match success rate'
      });
    }
    
    // Group matches by score range
    const scoreRanges = {
      '90-100': { total: 0, accepted: 0 },
      '80-89': { total: 0, accepted: 0 },
      '70-79': { total: 0, accepted: 0 },
      '60-69': { total: 0, accepted: 0 },
      '50-59': { total: 0, accepted: 0 },
      '0-49': { total: 0, accepted: 0 }
    };
    
    matches.forEach(match => {
      const score = match.compatibility_score || 0;
      let range;
      
      if (score >= 90) range = '90-100';
      else if (score >= 80) range = '80-89';
      else if (score >= 70) range = '70-79';
      else if (score >= 60) range = '60-69';
      else if (score >= 50) range = '50-59';
      else range = '0-49';
      
      scoreRanges[range].total++;
      if (match.status === 'accepted') {
        scoreRanges[range].accepted++;
      }
    });
    
    // Calculate success rates for each range
    const successRates = Object.entries(scoreRanges).map(([range, data]) => {
      return {
        range,
        total: data.total,
        accepted: data.accepted,
        successRate: data.total > 0 ? (data.accepted / data.total * 100).toFixed(2) : 0
      };
    });
    
    // Get overall success rate
    const totalMatches = matches.length;
    const acceptedMatches = matches.filter(m => m.status === 'accepted').length;
    const overallSuccessRate = totalMatches > 0 ? (acceptedMatches / totalMatches * 100).toFixed(2) : 0;
    
    // Get match success based on shared interests
    // This would require a more complex query to join with users table and compare interests
    
    return res.status(200).json({
      success: true,
      data: {
        overallSuccessRate: `${overallSuccessRate}%`,
        totalMatches,
        acceptedMatches,
        byCompatibilityScore: successRates
      }
    });
  } catch (error) {
    error('Error in getMatchSuccessRate:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching match success rate'
    });
  }
};

/**
 * Get recent system activity
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getRecentActivity = async (req, res) => {
  try {
    // Get limit for number of activities to return
    const limit = parseInt(req.query.limit) || 20;
    
    // Get recent user registrations
    const { data: newUsers, error: newUsersError } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (newUsersError) {
      error('Error fetching recent registrations:', newUsersError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch recent registrations'
      });
    }
    
    // Get recent matches
    const { data: newMatches, error: newMatchesError } = await supabase
      .from('matches')
      .select(`
        id, 
        created_at,
        status,
        user1:user1_id(id, first_name, last_name, username),
        user2:user2_id(id, first_name, last_name, username)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (newMatchesError) {
      error('Error fetching recent matches:', newMatchesError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch recent matches'
      });
    }

    // Get recent admin activity logs, including Gemini AI actions
    const { data: adminActivities, error: adminActivitiesError } = await supabase
      .from('admin_activity_log')
      .select(`
        id,
        admin_id,
        action,
        details,
        created_at,
        resource_type,
        resource_id,
        admin:admin_id(id, first_name, last_name, username, is_admin)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (adminActivitiesError) {
      error('Error fetching admin activities:', adminActivitiesError);
      // Don't return error, just continue without admin activities
    }
    
    // Initialize activities array with available data
    let activities = [
      ...newUsers.map(user => ({
        id: `user-${user.id}`,
        type: 'registration',
        description: `${user.first_name} ${user.last_name} (${user.username}) completed registration`,
        timestamp: user.created_at,
        data: { userId: user.id, username: user.username }
      })),
      ...newMatches.map(match => ({
        id: `match-${match.id}`,
        type: 'match',
        description: `New match created between ${match.user1.username} and ${match.user2.username}`,
        timestamp: match.created_at,
        data: { matchId: match.id, status: match.status }
      }))
    ];

    // Add admin activities if we got them successfully
    if (adminActivities && adminActivities.length > 0) {
      const formattedAdminActivities = adminActivities.map(activity => {
        // Check if this is a Gemini AI action (using the fixed UUID)
        const isGeminiAI = activity.admin_id === '00000000-0000-4000-a000-000000000001';
        const adminName = isGeminiAI 
          ? 'Gemini AI' 
          : (activity.admin 
            ? `${activity.admin.first_name} ${activity.admin.last_name}` 
            : 'Unknown Admin');
        
        // Format the action name for display
        let actionType = activity.action.replace(/_/g, ' ');
        if (actionType.startsWith('report')) {
          actionType = actionType.replace('report ', '');
        }
        
        return {
          id: `admin-${activity.id}`,
          type: 'admin_action',
          description: `${adminName} ${actionType} ${activity.resource_type || ''}: ${activity.details}`,
          timestamp: activity.created_at,
          data: { 
            adminId: activity.admin_id,
            action: activity.action,
            resourceType: activity.resource_type,
            resourceId: activity.resource_id,
            isAI: isGeminiAI
          }
        };
      });
      
      // Add to the activities array
      activities = [...activities, ...formattedAdminActivities];
    }
    
    try {
      // Try to get recent content reports (this may fail if the table doesn't exist)
      const { data: recentReports, error: reportsError } = await supabase
        .from('reports')
        .select(`
          id,
          report_type,
          content_type,
          content_id,
          reporter:reported_by(id, username),
          created_at,
          status,
          resolved_by
        `)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (!reportsError && recentReports) {
        // Add reports to activities if query was successful
        const reportActivities = await Promise.all(recentReports.map(async report => {
          // Get the resolver's info if available
          let resolverInfo = "Pending";
          if (report.resolved_by) {
            if (report.resolved_by === '00000000-0000-4000-a000-000000000001') {
              resolverInfo = "Gemini AI";
            } else {
              const { data: resolver } = await supabase
                .from('users')
                .select('username, first_name, last_name')
                .eq('id', report.resolved_by)
                .single();
              
              if (resolver) {
                resolverInfo = `${resolver.first_name} ${resolver.last_name}`;
              }
            }
          }
          
          return {
            id: `report-${report.id}`,
            type: 'report',
            description: `${report.reporter?.username || 'Anonymous'} reported ${report.content_type} for ${report.report_type}`,
            timestamp: report.created_at,
            data: { 
              reportId: report.id, 
              type: report.report_type, 
              contentType: report.content_type,
              status: report.status,
              resolvedBy: resolverInfo,
              isAIResolved: report.resolved_by === '00000000-0000-4000-a000-000000000001'
            }
          };
        }));
        
        activities = [...activities, ...reportActivities];
      }
    } catch (reportError) {
      // Just log the error but don't fail the entire request
      warn('Error fetching report data (table might not exist):', reportError);
    }
    
    // Sort by timestamp (most recent first)
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limit to requested number
    const limitedActivities = activities.slice(0, limit);
    
    return res.status(200).json({
      success: true,
      data: limitedActivities
    });
  } catch (error) {
    error('Error in getRecentActivity:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching recent activity'
    });
  }
};

/**
 * Get breakdown of report types
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const getReportTypesSummary = async (req, res) => {
  try {
    // Initialize default report types with zero counts
    const reportTypes = {
      'Inappropriate Content': 0,
      'Spam': 0,
      'Harassment': 0,
      'Impersonation': 0,
      'Others': 0
    };
    
    // Initialize status counts
    const statusCounts = {
      'pending': 0,
      'resolved': 0,
      'dismissed': 0
    };
    
    let totalReports = 0;
    let reports = [];
    
    try {
      // Get time period (default to all time)
      const days = req.query.days ? parseInt(req.query.days) : null;
      let query = supabase.from('reports').select('report_type, status, created_at');
      
      if (days) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        query = query.gte('created_at', startDate.toISOString());
      }
      
      const { data, error } = await query;
      
      if (!error && data) {
        reports = data;
        totalReports = data.length;
        
        // Count report types
        reports.forEach(report => {
          const type = report.report_type;
          if (reportTypes.hasOwnProperty(type)) {
            reportTypes[type]++;
          } else {
            reportTypes['Others']++;
          }
        });
        
        // Count status types
        reports.forEach(report => {
          const status = report.status || 'pending';
          if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
          }
        });
      }
    } catch (reportError) {
      // Log the error but return default empty data
      warn('Error fetching reports data (table might not exist):', reportError);
    }
    
    return res.status(200).json({
      success: true,
      data: {
        reportTypes: Object.entries(reportTypes).map(([type, count]) => ({ type, count })),
        statusCounts: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
        totalReports,
        period: req.query.days ? `${req.query.days} days` : 'All time'
      }
    });
  } catch (error) {
    error('Error in getReportTypesSummary:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching report types summary'
    });
  }
};

// Helper functions for data processing
const processMonthlyGrowth = (userData) => {
  const monthlyGrowth = [];
  const months = {};
  
  userData.forEach(user => {
    const date = new Date(user.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!months[monthKey]) {
      months[monthKey] = 0;
    }
    
    months[monthKey]++;
  });
  
  // Convert to array and sort by month
  Object.entries(months).forEach(([month, count]) => {
    monthlyGrowth.push({ month, count });
  });
  
  monthlyGrowth.sort((a, b) => a.month.localeCompare(b.month));
  
  return monthlyGrowth;
};

const processGenderDistribution = (userData) => {
  // Initialize with main categories
  const genders = {
    male: 0,
    female: 0,
    transgender: 0,
    'non-binary': 0,
    genderqueer: 0,
    genderfluid: 0,
    agender: 0,
    other: 0
  };
  
  // Map similar terms to standardized categories
  const genderMap = {
    trans: 'transgender',
    nonbinary: 'non-binary',
    'two-spirit': 'other',
    'third-gender': 'other',
    queer: 'other',
    questioning: 'other',
    intersex: 'other',
    bigender: 'other'
  };
  
  userData.forEach(user => {
    if (!user.gender) return;
    
    const gender = user.gender.toLowerCase();
    
    // Check if it's one of our main categories
    if (genders.hasOwnProperty(gender)) {
      genders[gender]++;
    } 
    // Check if it maps to one of our standardized categories
    else if (genderMap.hasOwnProperty(gender)) {
      genders[genderMap[gender]]++;
    } 
    // Otherwise put in other
    else {
      genders.other++;
    }
  });
  
  return Object.entries(genders).map(([gender, count]) => ({ gender, count }));
};

const processHourlyActivity = (users, messages) => {
  const hourly = Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }));
  
  // Process login times
  users.forEach(user => {
    if (user.last_login) {
      const hour = new Date(user.last_login).getHours();
      hourly[hour].count++;
    }
  });
  
  // Process message times
  messages.forEach(message => {
    const hour = new Date(message.created_at).getHours();
    hourly[hour].count++;
  });
  
  return hourly;
};

const processDailyActivity = (users, messages, matches) => {
  const daily = Array(7).fill(0).map((_, i) => ({ 
    day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i], 
    count: 0 
  }));
  
  // Process login times
  users.forEach(user => {
    if (user.last_login) {
      const day = new Date(user.last_login).getDay();
      daily[day].count++;
    }
  });
  
  // Process message times
  messages.forEach(message => {
    const day = new Date(message.created_at).getDay();
    daily[day].count++;
  });
  
  // Process match creation times
  matches.forEach(match => {
    const day = new Date(match.created_at).getDay();
    daily[day].count++;
  });
  
  return daily;
};

const processMatchesByDate = (matches) => {
  const matchesByDate = {};
  
  matches.forEach(match => {
    const date = new Date(match.created_at).toISOString().split('T')[0];
    
    if (!matchesByDate[date]) {
      matchesByDate[date] = {
        date,
        total: 0,
        accepted: 0,
        rejected: 0,
        pending: 0,
        expired: 0
      };
    }
    
    matchesByDate[date].total++;
    matchesByDate[date][match.status || 'pending']++;
  });
  
  // Convert to array and sort by date
  return Object.values(matchesByDate).sort((a, b) => a.date.localeCompare(b.date));
};

const processMessagesByDate = (messages) => {
  const messagesByDate = {};
  
  messages.forEach(message => {
    const date = new Date(message.created_at).toISOString().split('T')[0];
    
    if (!messagesByDate[date]) {
      messagesByDate[date] = {
        date,
        count: 0,
        read: 0,
        unread: 0
      };
    }
    
    messagesByDate[date].count++;
    messagesByDate[date][message.is_read ? 'read' : 'unread']++;
  });
  
  // Convert to array and sort by date
  return Object.values(messagesByDate).sort((a, b) => a.date.localeCompare(b.date));
};

const calculateTrend = (data) => {
  if (data.length < 2) return 'stable';
  
  const firstHalf = data.slice(0, Math.floor(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  
  const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
  
  const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;
  
  if (percentChange > 5) return 'increasing';
  if (percentChange < -5) return 'decreasing';
  return 'stable';
};

module.exports = {
  getTotalUsers,
  getUserActivity,
  getDailyActiveUsers,
  getMatchesCreated,
  getMessagesSent,
  getMatchSuccessRate,
  getRecentActivity,
  getReportTypesSummary
}; 