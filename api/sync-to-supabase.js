// Serverless function to fetch Twitter data and sync to Supabase
// This keeps your database updated with latest tweets

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Allow GET for Vercel Cron Jobs, POST for manual triggers
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get credentials from environment
    const API_KEY = process.env.API_KEY;
    const COMMUNITY_ID = process.env.COMMUNITY_ID;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!API_KEY || !COMMUNITY_ID || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Missing environment variables" });
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    console.log("Fetching Twitter data...");

    // Fetch from Twitter API
    const response = await axios.get(
      "https://api.twitterapi.io/twitter/community/tweets",
      {
        headers: {
          "X-API-Key": API_KEY,
          "User-Agent": "DeFi-Hub/1.0",
        },
        params: {
          community_id: COMMUNITY_ID,
          limit: 100, // Get more tweets for better data
        },
        timeout: 15000,
      }
    );

    const tweets = response.data.tweets || [];
    console.log(`Fetched ${tweets.length} tweets`);

    let userStats = {};
    let tweetRecords = [];

    // Process tweets
    for (const tweet of tweets) {
      const author = tweet.user_info || tweet.author || tweet.user;
      if (!author) continue;

      const handle = author.screen_name || author.userName;
      const tweetId = tweet.id_str || tweet.id;
      const tweetText = tweet.text || tweet.full_text || "";
      const createdAt = tweet.created_at || tweet.createdAt;

      // Aggregate user stats
      if (!userStats[handle]) {
        userStats[handle] = {
          handle: handle,
          name: author.name,
          avatar: (
            author.profile_image_url_https ||
            author.profilePicture ||
            ""
          ).replace("_normal", ""),
          total_tweets: 0,
          total_likes: 0,
          total_replies: 0,
          total_retweets: 0,
        };
      }

      userStats[handle].total_tweets += 1;
      userStats[handle].total_likes +=
        tweet.favorite_count || tweet.likeCount || 0;
      userStats[handle].total_retweets +=
        tweet.retweet_count || tweet.retweetCount || 0;
      userStats[handle].total_replies +=
        tweet.reply_count || tweet.replyCount || 0;

      // Store individual tweet
      tweetRecords.push({
        id: tweetId,
        user_handle: handle,
        text: tweetText,
        likes: tweet.favorite_count || tweet.likeCount || 0,
        retweets: tweet.retweet_count || tweet.retweetCount || 0,
        replies: tweet.reply_count || tweet.replyCount || 0,
        tweet_date: new Date(createdAt).toISOString(),
      });
    }

    console.log(`Processed ${Object.keys(userStats).length} users`);

    // Upsert users to Supabase
    const usersArray = Object.values(userStats);
    const { data: upsertedUsers, error: usersError } = await supabase
      .from("users")
      .upsert(usersArray, {
        onConflict: "handle",
        ignoreDuplicates: false,
      })
      .select();

    if (usersError) {
      console.error("Users upsert error:", usersError);
      throw usersError;
    }

    console.log(`Upserted ${usersArray.length} users`);

    // Upsert tweets to Supabase (will skip duplicates based on tweet ID)
    const { data: upsertedTweets, error: tweetsError } = await supabase
      .from("tweets")
      .upsert(tweetRecords, {
        onConflict: "id",
        ignoreDuplicates: true, // Don't update existing tweets
      })
      .select();

    if (tweetsError) {
      console.error("Tweets upsert error:", tweetsError);
      throw tweetsError;
    }

    const newTweetsCount = upsertedTweets ? upsertedTweets.length : 0;
    console.log(`Added ${newTweetsCount} new tweets`);

    res.status(200).json({
      success: true,
      message: "Data synced successfully",
      stats: {
        users: usersArray.length,
        newTweets: newTweetsCount,
        totalTweets: tweetRecords.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sync error:", error.message);
    res.status(500).json({
      success: false,
      error: "Sync failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
