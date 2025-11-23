// THIS IS A SERVER-SIDE SCRIPT
// Run with: node backend/twitter_indexer.js
// Requires: npm install axios

require("dotenv").config(); // Load environment variables
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// 1. Your API Key from environment
const API_KEY = process.env.API_KEY;

// 2. Your Community ID from environment
const COMMUNITY_ID = process.env.COMMUNITY_ID;

// Validate required environment variables
if (!API_KEY || !COMMUNITY_ID) {
  console.error(
    "❌ Missing required environment variables: API_KEY or COMMUNITY_ID"
  );
  process.exit(1);
}

const COMMUNITY_URL = "https://api.twitterapi.io/twitter/community/tweets";

// Ensure the output directory exists
const outputDir = path.join(__dirname, "../public/api");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

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

    // Save File
    const outputPath = path.join(outputDir, "users.json");
    fs.writeFileSync(outputPath, JSON.stringify(leaderboardCache, null, 2));
    console.log(`💾 Saved to ${outputPath}`);
  } catch (error) {
    console.error(
      "❌ API Error:",
      error.response ? error.response.data : error.message
    );
  }
}

// Run immediately on startup
indexCommunityTweets();

// Only run setInterval if not in CI/GitHub Actions environment
if (!process.env.CI && !process.env.GITHUB_ACTIONS) {
  // Run every 2 days (2 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds)
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  setInterval(indexCommunityTweets, TWO_DAYS);
  console.log(`🔄 Auto-update scheduled every 2 days (${TWO_DAYS}ms)`);
} else {
  console.log(`✅ Running in CI mode - will exit after this run`);
}
