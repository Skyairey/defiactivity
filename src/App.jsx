import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three"; // Requires: npm install three
import {
  Users,
  Heart,
  Eye,
  Search,
  RefreshCw,
  ArrowLeft,
  Twitter,
  MessageCircle,
  Repeat,
} from "lucide-react"; // Requires: npm install lucide-react

// --- Configuration ---
// Your specific Twitter Community URL
const COMMUNITY_URL = "https://twitter.com/i/communities/1797339800241881157";
const USERS_PER_PAGE = 10;
const CACHE_KEY = "defiapp_leaderboard_cache";
const CACHE_TIMESTAMP_KEY = "defiapp_leaderboard_timestamp";

// --- 1. Three.js Background Component ---
const Background3D = () => {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // Setup Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020202, 0.002);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 40;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    // Create Particles
    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 800;
    const posArray = new Float32Array(particlesCount * 3);
    for (let i = 0; i < particlesCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 150;
    }
    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(posArray, 3)
    );

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.2,
      color: 0x3b82f6, // Blue-500
      transparent: true,
      opacity: 0.4,
    });

    const particlesMesh = new THREE.Points(
      particlesGeometry,
      particlesMaterial
    );
    scene.add(particlesMesh);

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);
      particlesMesh.rotation.y -= 0.0005;
      renderer.render(scene, camera);
    };
    animate();

    // Handle Resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed top-0 left-0 w-full h-full -z-10 pointer-events-none bg-[#020202]"
    />
  );
};

// --- 2. Helper Components ---

const StatCard = ({ label, value, colorClass, Icon }) => (
  <div className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-xl p-6 flex flex-col items-center justify-center text-center transition-all hover:bg-slate-800/80 hover:border-blue-500/30 group">
    <span
      className={`text-xs uppercase font-bold mb-1 flex items-center gap-2 ${colorClass}`}
    >
      {Icon && <Icon size={14} />} {label}
    </span>
    <span className="text-3xl font-black text-white">{value}</span>
  </div>
);

const TweetCard = ({ user, tweet }) => (
  <div className="border-b border-white/5 p-6 hover:bg-white/5 transition-colors">
    <div className="flex justify-between items-start mb-2">
      <div className="flex items-center gap-2">
        <span className="font-bold text-white text-sm">{user.name}</span>
        <span className="text-gray-500 text-xs">
          {user.handle} · {tweet.date}
        </span>
      </div>
      <a href="#" className="text-gray-500 hover:text-blue-400">
        <Twitter size={16} />
      </a>
    </div>
    <p className="text-gray-300 text-sm mb-3 leading-relaxed">{tweet.text}</p>
    <div className="flex gap-6 text-xs text-gray-500">
      <div className="flex items-center gap-1 hover:text-pink-400 transition-colors cursor-pointer">
        <Heart size={14} />
        {tweet.likes}
      </div>
      <div className="flex items-center gap-1 hover:text-green-400 transition-colors cursor-pointer">
        <Repeat size={14} />
        {tweet.retweets}
      </div>
    </div>
  </div>
);

// --- 3. Main Application Component ---
export default function App() {
  const [view, setView] = useState("leaderboard");
  const [users, setUsers] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLiveData, setIsLiveData] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // --- Local cache helpers ---
  const readCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (!raw) return { data: null, timestamp: ts ? parseInt(ts) : null };
      return { data: JSON.parse(raw), timestamp: ts ? parseInt(ts) : null };
    } catch (e) {
      console.warn("readCache failed:", e);
      return { data: null, timestamp: null };
    }
  };

  const saveCache = (arr) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
      console.warn("saveCache failed:", e);
    }
  };

  // Merge incoming API data with existing cached objects (by handle) so
  // we don't lose additional fields like `recentTweets` that may exist
  // only in cache. Incoming data takes precedence for overlapping keys.
  const mergeWithCache = (incoming) => {
    if (!Array.isArray(incoming)) return incoming;
    const { data: cached } = readCache();
    if (!Array.isArray(cached) || cached.length === 0) return incoming;
    const map = new Map();
    cached.forEach((u) => map.set(u.handle, u));
    return incoming.map((u) => ({ ...(map.get(u.handle) || {}), ...u }));
  };

  // --- SECURE DATA FETCHING LOGIC WITH CACHING ---
  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch from Supabase-backed serverless endpoint
      const response = await fetch("/api/get-leaderboard", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result = await response.json();

      if (
        result.success &&
        Array.isArray(result.data) &&
        result.data.length > 0
      ) {
        // Success! Merge with cache, save to localStorage and update state
        const merged = mergeWithCache(result.data);
        saveCache(merged);
        setUsers(merged);
        setIsLiveData(true);
        console.log("✅ Live data loaded and cached (merged)");
      } else {
        throw new Error("Invalid data format received");
      }
    } catch (error) {
      console.warn(
        "⚠️ API failed, loading from cache or fallback:",
        error.message
      );
      setIsLiveData(false);

      // Try to load from localStorage cache first (use helper)
      try {
        const { data: parsedData, timestamp: cachedTimestamp } = readCache();
        if (Array.isArray(parsedData) && parsedData.length > 0) {
          setUsers(parsedData);
          const cacheAge = cachedTimestamp
            ? Math.floor((Date.now() - parseInt(cachedTimestamp)) / (1000 * 60 * 60))
            : "unknown";
          console.log(`📦 Loaded from cache (${cacheAge} hours old)`);
          return;
        }
      } catch (cacheError) {
        console.warn("Cache read failed:", cacheError);
      }

      // Last resort: fallback to static JSON file
      try {
        const fallbackResponse = await fetch("api/users.json");
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            const rankedData = fallbackData.map((u, i) => ({
              ...u,
              rank: i + 1,
            }));
            setUsers(rankedData);
            // Cache this fallback data too
            saveCache(rankedData);
            console.log("📄 Loaded from static fallback file");
            return;
          }
        }
      } catch (fallbackError) {
        console.error("❌ All data sources failed");
      }

      // If everything fails, set empty array
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  // Load cached data immediately on mount, then fetch fresh data
  useEffect(() => {
    // First, try to load from cache for instant display
    try {
      const { data: parsedData } = readCache();
      if (Array.isArray(parsedData) && parsedData.length > 0) {
        setUsers(parsedData);
        setLoading(false);
        console.log("⚡ Instant load from cache");
      }
    } catch (error) {
      console.warn("Failed to read cache for instant load", error);
    }

    // Then fetch fresh data in the background
    loadData();
  }, []);

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Navigation Helpers
  const openProfile = (user) => {
    setSelectedProfile(user);
    setView("profile");
    window.scrollTo(0, 0);
  };

  const goBack = () => {
    setView("leaderboard");
    setSelectedProfile(null);
    window.scrollTo(0, 0);
  };

  // Filter and Pagination Logic
  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.handle.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / USERS_PER_PAGE)
  );
  const startIndex = (currentPage - 1) * USERS_PER_PAGE;
  const endIndex = startIndex + USERS_PER_PAGE;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  // Calculate Aggregate Stats
  const totalTweets = users.reduce((acc, u) => acc + (u.tweets || 0), 0);
  const totalLikes = users.reduce((acc, u) => acc + (u.likes || 0), 0);

  return (
    <div className="font-sans text-gray-100 min-h-screen relative overflow-x-hidden selection:bg-blue-500/30">
      {/* 3D Background */}
      <Background3D />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={goBack}
            >
              <img
                src="/images/public.png"
                alt="DeFi App"
                className="w-6 h-6 object-contain"
              />
              <span className="font-bold text-lg text-white tracking-tight">
                Defiapp <span className="text-blue-500">Community</span>
              </span>
            </div>

            <div className="flex gap-3">
              <a
                href={COMMUNITY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-white/10 px-6 py-2 text-sm font-medium text-white hover:bg-white/10 transition-all"
              >
                Join Community
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* VIEW: LEADERBOARD */}
        {view === "leaderboard" && (
          <div className="animate-fade-in">
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tight">
                COMMUNITY{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                  ACTIVITY
                </span>
              </h1>
              <p className="text-gray-400 text-sm uppercase tracking-widest mb-10">
                Tracking engagement within the{" "}
                <span className="text-blue-400 font-bold">
                  Defiapp Community
                </span>{" "}
                on X
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
                <StatCard
                  label="Community Posts"
                  value={totalTweets.toLocaleString()}
                  colorClass="text-blue-400"
                  Icon={MessageCircle}
                />
                <StatCard
                  label="Active Members"
                  value={users.length}
                  colorClass="text-purple-400"
                  Icon={Users}
                />
                <StatCard
                  label="Total Likes"
                  value={(totalLikes / 1000).toFixed(1) + "K"}
                  colorClass="text-green-400"
                  Icon={Heart}
                />
                <StatCard
                  label="Impressions"
                  value={((totalLikes * 45) / 1000).toFixed(1) + "K"}
                  colorClass="text-pink-400"
                  Icon={Eye}
                />
              </div>
            </div>

            <div className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden max-w-6xl mx-auto shadow-2xl">
              <div className="p-4 border-b border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search member..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-black/30 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors placeholder-gray-600"
                  />
                  <Search className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    Status:{" "}
                    {isLiveData ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />{" "}
                        Live
                      </span>
                    ) : (
                      <span className="text-yellow-500 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-yellow-500" />{" "}
                        Waiting for Backend
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 border-l border-white/10 pl-3">
                    Data refreshes every 2 days
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/40 border-b border-white/5 text-xs uppercase text-gray-500 font-semibold">
                      <th className="p-4 w-16 text-center">#</th>
                      <th className="p-4">Member</th>
                      <th className="p-4 text-right">Posts</th>
                      <th className="p-4 text-right">Likes</th>
                      <th className="p-4 text-right hidden md:table-cell">
                        Retweets
                      </th>
                      <th className="p-4 text-right hidden md:table-cell">
                        Score
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && users.length === 0
                      ? [...Array(10)].map((_, i) => (
                          <tr key={i} className="border-b border-white/5">
                            <td className="p-4 text-center">
                              <div className="h-4 w-8 bg-white/5 rounded animate-pulse mx-auto"></div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse shrink-0"></div>
                                <div className="flex flex-col gap-2">
                                  <div className="h-3 w-32 bg-white/5 rounded animate-pulse"></div>
                                  <div className="h-3 w-24 bg-white/5 rounded animate-pulse"></div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="h-4 w-12 bg-white/5 rounded animate-pulse ml-auto"></div>
                            </td>
                            <td className="p-4">
                              <div className="h-4 w-16 bg-white/5 rounded animate-pulse ml-auto"></div>
                            </td>
                            <td className="p-4 hidden md:table-cell">
                              <div className="h-4 w-12 bg-white/5 rounded animate-pulse ml-auto"></div>
                            </td>
                            <td className="p-4 hidden md:table-cell">
                              <div className="w-16 h-1.5 bg-white/5 rounded-full animate-pulse ml-auto"></div>
                            </td>
                          </tr>
                        ))
                      : paginatedUsers.map((user, index) => (
                          <tr
                            key={user.handle}
                            onClick={() => openProfile(user)}
                            className="border-b border-white/5 hover:bg-white/10 transition-colors cursor-pointer group"
                          >
                            <td className="p-4 text-center">
                              <span className="text-gray-400 font-mono text-sm font-bold">
                                {startIndex + index + 1}
                              </span>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full shadow-lg relative overflow-hidden bg-gray-800 flex items-center justify-center shrink-0">
                                  {user.avatarUrl ? (
                                    <img
                                      src={user.avatarUrl}
                                      alt={user.name}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        e.target.style.display = "none";
                                        e.target.nextSibling.style.display =
                                          "flex";
                                      }}
                                    />
                                  ) : null}
                                  <div
                                    className={`w-full h-full flex items-center justify-center font-bold text-white ${
                                      user.avatarUrl ? "hidden" : ""
                                    }`}
                                    style={{
                                      backgroundColor: user.avatarColor,
                                    }}
                                  >
                                    {user.name[0]}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-white font-bold text-sm flex items-center gap-2">
                                    {user.name}
                                  </div>
                                  <div className="text-blue-400 text-xs group-hover:underline">
                                    {user.handle}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-right text-gray-300 font-mono text-sm">
                              {user.tweets}
                            </td>
                            <td className="p-4 text-right text-green-400 font-mono font-bold text-sm">
                              {user.likes.toLocaleString()}
                            </td>
                            <td className="p-4 text-right text-gray-400 font-mono text-sm hidden md:table-cell">
                              {user.rts.toLocaleString()}
                            </td>
                            <td className="p-4 text-right hidden md:table-cell">
                              <div className="w-full flex justify-end">
                                <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500"
                                    style={{
                                      width: `${Math.min(user.score, 100)}%`,
                                    }}
                                  ></div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>

              {/* --- PAGINATION CONTROLS --- */}
              <div className="p-4 border-t border-white/5 flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  Page{" "}
                  <span className="font-bold text-gray-300">{currentPage}</span>{" "}
                  of{" "}
                  <span className="font-bold text-gray-300">{pageCount}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(prev - 1, 1))
                    }
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-md bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(prev + 1, pageCount))
                    }
                    disabled={currentPage === pageCount}
                    className="px-3 py-1.5 rounded-md bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: PROFILE */}
        {view === "profile" && selectedProfile && (
          <div className="max-w-5xl mx-auto animate-fade-in">
            <button
              onClick={goBack}
              className="mb-6 flex items-center text-gray-400 hover:text-white transition-colors group"
            >
              <ArrowLeft className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
              Back to Leaderboard
            </button>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left Column */}
              <div className="md:col-span-1">
                <div className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-xl p-6 text-center sticky top-24">
                  <div className="relative inline-block mb-4">
                    <div className="w-24 h-24 rounded-full border-4 border-black overflow-hidden shadow-2xl mx-auto bg-gray-800 flex items-center justify-center">
                      {selectedProfile.avatarUrl ? (
                        <img
                          src={selectedProfile.avatarUrl}
                          alt={selectedProfile.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = "none";
                            e.target.nextSibling.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        className={`w-full h-full flex items-center justify-center font-bold text-white text-4xl ${
                          selectedProfile.avatarUrl ? "hidden" : ""
                        }`}
                        style={{ backgroundColor: selectedProfile.avatarColor }}
                      >
                        {selectedProfile.name[0]}
                      </div>
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                    {selectedProfile.name}
                  </h2>
                  <a
                    href={`https://twitter.com/${selectedProfile.handle.replace(
                      "@",
                      ""
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 text-sm hover:underline mb-6 block"
                  >
                    {selectedProfile.handle}
                  </a>

                  <div className="grid grid-cols-2 gap-4 mb-6 border-t border-white/10 pt-6">
                    <div>
                      <div className="text-gray-500 text-xs uppercase font-bold">
                        Total Score
                      </div>
                      <div className="text-xl font-bold text-white">
                        {selectedProfile.score}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase font-bold">
                        Posts
                      </div>
                      <div className="text-xl font-bold text-white">
                        {selectedProfile.tweets}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase font-bold">
                        Likes
                      </div>
                      <div className="text-xl font-bold text-green-400">
                        {selectedProfile.likes.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase font-bold">
                        Retweets
                      </div>
                      <div className="text-xl font-bold text-purple-400">
                        {selectedProfile.rts.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <a
                    href={`https://twitter.com/${selectedProfile.handle.replace(
                      "@",
                      ""
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full block bg-white text-black font-bold py-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    View on X
                  </a>
                </div>
              </div>

              {/* Right Column */}
              <div className="md:col-span-2">
                <h3 className="text-xl font-bold text-white mb-4 flex items-center">
                  <MessageCircle className="w-5 h-5 mr-2 text-blue-500" />
                  Recent Activity
                </h3>
                <div className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-xl overflow-hidden">
                  {selectedProfile.recentTweets &&
                  selectedProfile.recentTweets.length > 0 ? (
                    selectedProfile.recentTweets.map((tweet, idx) => (
                      <TweetCard
                        key={idx}
                        user={selectedProfile}
                        tweet={tweet}
                      />
                    ))
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      No recent tweets found.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
