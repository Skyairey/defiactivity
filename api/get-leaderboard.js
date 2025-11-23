// Serverless function to fetch leaderboard data from Supabase
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Missing Supabase configuration' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Fetch users with their recent tweets, ordered by likes
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .order('total_likes', { ascending: false });

    if (usersError) throw usersError;

    // For each user, fetch their recent 5 tweets
    const leaderboard = await Promise.all(
      users.map(async (user, index) => {
        const { data: recentTweets } = await supabase
          .from('tweets')
          .select('*')
          .eq('user_handle', user.handle)
          .order('tweet_date', { ascending: false })
          .limit(5);

        return {
          rank: index + 1,
          name: user.name,
          handle: `@${user.handle}`,
          avatarUrl: user.avatar || '',
          avatarColor: '#3b82f6',
          tweets: user.total_tweets,
          likes: user.total_likes,
          rts: user.total_retweets,
          score: user.total_likes + user.total_retweets * 2 + user.total_tweets * 5,
          recentTweets: (recentTweets || []).map(tweet => ({
            text: tweet.text,
            date: new Date(tweet.tweet_date).toLocaleDateString(),
            likes: tweet.likes,
            retweets: tweet.retweets,
          }))
        };
      })
    );

    res.status(200).json({
      success: true,
      data: leaderboard,
      timestamp: new Date().toISOString(),
      totalUsers: leaderboard.length,
      source: 'supabase'
    });

  } catch (error) {
    console.error('Fetch error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch data',
      timestamp: new Date().toISOString()
    });
  }
};
