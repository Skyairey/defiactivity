// THIS IS A SERVER-SIDE SCRIPT
// Run with: node backend/twitter_indexer.js
// Requires: npm install axios @supabase/supabase-js

require("dotenv").config(); // Load environment variables
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// Environment variables
const API_KEY = process.env.API_KEY;
const COMMUNITY_ID = process.env.COMMUNITY_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Validate required environment variables
if (!API_KEY || !COMMUNITY_ID || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "❌ Missing required environment variables"
  );
  process.exit(1);
}

const COMMUNITY_URL = "https://api.twitterapi.io/twitter/community/tweets";

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function indexCommunityTweets() {
  console.log(
    `📡 Fetching tweets via TwitterAPI.io for Community: ${COMMUNITY_ID}...`
  );

  try {
    const response = await axios.get(COMMUNITY_URL, {
      headers: { "X-API-Key": API_KEY },
      params: {
        community_id: COMMUNITY_ID,
        limit: 40,
      },
    });

    const tweets = response.data.tweets || [];
    let userStats = {};

    console.log(`   ↳ Found ${tweets.length} tweets.`);

    for (const tweet of tweets) {
      // Extract Author
      const author = tweet.user_info || tweet.author || tweet.user;
      if (!author) continue;

      // Handle ID variations (id vs id_str)
      const authorId = author.id_str || author.id;

      if (!userStats[authorId]) {
        userStats[authorId] = {
          rank: 0,
          name: author.name,
          handle: `@${author.screen_name || author.userName}`,
          // Use high-res image if available, fall back to normal
          avatarUrl: (
            author.profile_image_url_https ||
            author.profilePicture ||
            ""
          ).replace("_normal", ""),
          avatarColor: "#3b82f6",
          tweets: 0,
          likes: 0,
          rts: 0,
          score: 0,
          recentTweets: [],
        };
      }

      // Update Counts
      userStats[authorId].tweets += 1;
      userStats[authorId].likes += tweet.favorite_count || tweet.likeCount || 0;
      userStats[authorId].rts += tweet.retweet_count || tweet.retweetCount || 0;

      // Store Tweet for Profile
      if (userStats[authorId].recentTweets.length < 5) {
        userStats[authorId].recentTweets.push({
          text: tweet.text || tweet.full_text,
          date: new Date(
            tweet.created_at || tweet.createdAt
          ).toLocaleDateString(),
          likes: tweet.favorite_count || tweet.likeCount || 0,
          retweets: tweet.retweet_count || tweet.retweetCount || 0,
        });
      }
    }

    // Rank Users
    let leaderboardCache = Object.values(userStats)
      .map((u) => {
        // Score Algorithm: 1 Like = 1pt, 1 RT = 2pts, 1 Post = 5pts
        u.score = u.likes + u.rts * 2 + u.tweets * 5;
        return u;
      })
      .sort((a, b) => b.score - a.score);

    // Assign Ranks
    leaderboardCache.forEach((u, i) => (u.rank = i + 1));

    console.log(`✅ Successfully indexed ${leaderboardCache.length} members.`);

    // Save to Supabase
    console.log("💾 Saving to Supabase...");
    
    // Clear existing data
    await supabase.from("leaderboard").delete().neq("rank", 0);
    
    // Insert new data
    const { data, error } = await supabase
      .from("leaderboard")
      .insert(leaderboardCache);

    if (error) {
      console.error("❌ Supabase Error:", error.message);
      process.exit(1);
    }

    console.log(`✅ Successfully saved ${leaderboardCache.length} members to Supabase!`);
    process.exit(0); // Explicitly exit with success
  } catch (error) {
    console.error(
      "❌ API Error:",
      error.response ? error.response.data : error.message
    );
    process.exit(1); // Exit with error code
  }
}

// Run immediately - Render Cron Job will execute this script every 2 days
indexCommunityTweets();
