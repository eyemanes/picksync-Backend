import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { chatWithGamblina, getGamblinaUsageStats } from './gamblina.js';
import {
  initDatabase,
  getAllScans,
  getPicksByScanId,
  getTodaysPicks,
  getCurrentPOTDPicks,
  getHistoryPOTDs,
  getFinishedPicks,
  updatePickResult,
  updateUserAction,
  updateGameTime,
  getMyBets,
  getPicksByDate,
  getDatesWithPicks,
  saveChatMessage,
  getChatHistory,
  getPickStats,
  getSchedulerLogs,
  optimizeDatabase,
  removeDuplicates,
  deletePick,
} from './database.js';
import { login, verifyToken, requireAdmin, initUsersTable, getAllUsers, createUser, updateUserRole, deleteUser } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { startScheduler, stopScheduler, runScan, getSchedulerStatus } from './scheduler.js';
import { startBackupScheduler } from './backup.js';
import { getScanStatus } from './scanState.js';
import { 
  getCache, 
  setCache, 
  deleteCache, 
  clearCache, 
  getCacheStats, 
  CACHE_KEYS,
  CACHE_TTL,
  warmCache 
} from './cache.js';
import * as database from './database.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://picksync-frontend-k8an.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(express.json());

// Security: Trust proxy (important for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Request logging (always enabled for debugging)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.path === '/api/scan') {
    console.log('   Headers:', req.headers.authorization ? '✅ Auth token present' : '❌ No auth token');
  }
  next();
});

// Initialize database
initDatabase();

// Initialize users system
initUsersTable();

// Warm cache on startup
setTimeout(() => warmCache(database), 2000);

// Start automated scheduler
if (process.env.ENABLE_SCHEDULER !== 'false') {
  startScheduler();
}

// Start automated backup scheduler
startBackupScheduler();

// Database optimization on startup
optimizeDatabase();

// === PUBLIC ENDPOINTS ===

app.get('/health', (req, res) => {
  const schedulerStatus = getSchedulerStatus();
  const cacheStats = getCacheStats();
  const gamblinaStats = getGamblinaUsageStats();
  
  res.json({ 
    status: 'OK',
    version: '2.0.0-optimized',
    timestamp: new Date().toISOString(),
    scheduler: schedulerStatus,
    cache: {
      keys: cacheStats.keys,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: `${cacheStats.hitRate}%`,
    },
    apiUsage: {
      gamblinaCallsThisMonth: gamblinaStats.callsThisMonth,
      estimatedMonthlyCost: `$${gamblinaStats.estimatedMonthlyCost.toFixed(2)}`,
    }
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const result = login(username, password);
  res.json(result);
});

// Admin routes (requires authentication)
app.use('/api/admin', verifyToken, adminRoutes);

// Get today's picks (CURRENT POTD ONLY)
app.get('/api/picks/today', async (req, res) => {
  try {
    const cached = getCache(CACHE_KEYS.TODAY_PICKS);
    if (cached) {
      return res.json({
        success: true,
        ...cached,
        cached: true,
      });
    }

    const result = getCurrentPOTDPicks();
    
    if (result.picks.length > 0) {
      setCache(CACHE_KEYS.TODAY_PICKS, result, CACHE_TTL.TODAY_PICKS);
      
      return res.json({
        success: true,
        picks: result.picks,
        potdTitle: result.potdTitle,
        potdDate: result.potdDate,
        scanId: result.scanId,
        cached: false,
      });
    }

    res.json({
      success: true,
      picks: [],
      potdTitle: '',
      potdDate: '',
      cached: false,
      message: 'No picks yet. Next scan at scheduled time.',
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// === PROTECTED ENDPOINTS ===

// Get scan status (polling endpoint - NO AUTH REQUIRED for simplicity)
app.get('/api/scan/status', (req, res) => {
  const status = getScanStatus();
  res.json({
    success: true,
    ...status
  });
});

// Start a new scan (fire and forget) - RATE LIMITED + ADMIN ONLY
app.post('/api/scan', rateLimit(15 * 60 * 1000, 5), verifyToken, requireAdmin, async (req, res) => {
  console.log('\n🔄 ===== MANUAL SCAN REQUESTED =====');
  console.log('👤 Authorized user triggered scan');
  console.log('⏰ Time:', new Date().toISOString());
  
  // Check if scan is already running
  const currentStatus = getScanStatus();
  if (currentStatus.scanning) {
    return res.json({
      success: false,
      error: 'Scan already in progress',
      status: currentStatus
    });
  }
  
  // Start scan immediately and return
  res.json({ 
    success: true, 
    message: 'Scan started. Poll /api/scan/status for updates.' 
  });
  
  // Run scan in background
  runScan().catch(error => {
    console.error('❌ Manual scan failed:', error);
  });
});

// Get all scans (archives) with caching
app.get('/api/archives', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const cacheKey = `${CACHE_KEYS.RECENT_SCANS}:${limit}:${offset}`;
    const cached = getCache(cacheKey);
    
    if (cached) {
      return res.json({ success: true, scans: cached, cached: true });
    }
    
    const scans = getAllScans(limit, offset);
    setCache(cacheKey, scans, CACHE_TTL.RECENT_SCANS);
    
    res.json({ success: true, scans, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get HISTORY POTDs (old POTDs only)
app.get('/api/archives/potds', verifyToken, (req, res) => {
  try {
    const cached = getCache('history_potds');
    if (cached) {
      return res.json({ success: true, potds: cached, cached: true });
    }
    
    const potds = getHistoryPOTDs();
    setCache('history_potds', potds, 1800);
    
    res.json({ success: true, potds, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get picks for specific scan
app.get('/api/archives/:scanId', verifyToken, (req, res) => {
  try {
    const cacheKey = `scan:${req.params.scanId}`;
    const cached = getCache(cacheKey);
    
    if (cached) {
      return res.json({ success: true, picks: cached, cached: true });
    }
    
    const picks = getPicksByScanId(req.params.scanId);
    setCache(cacheKey, picks, 3600);
    
    res.json({ success: true, picks, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get finished picks (won/lost/push - not pending)
app.get('/api/picks/finished', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const cached = getCache('finished_picks');
    
    if (cached) {
      return res.json({ success: true, picks: cached, cached: true });
    }
    
    const picks = getFinishedPicks(limit);
    setCache('finished_picks', picks, 300);
    
    res.json({ success: true, picks, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Chat with GAMBLINA
app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    
    const stats = getPickStats();
    const recentPicks = getTodaysPicks().slice(0, 5);
    
    const context = {
      stats: stats.overall,
      recentPicks,
    };

    const aiResponse = await chatWithGamblina(message, context);
    saveChatMessage(message, aiResponse, context);
    deleteCache(CACHE_KEYS.CHAT_HISTORY);
    
    res.json({ success: true, response: aiResponse });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get chat history
app.get('/api/chat/history', verifyToken, (req, res) => {
  try {
    const cached = getCache(CACHE_KEYS.CHAT_HISTORY);
    
    if (cached) {
      return res.json({ success: true, history: cached, cached: true });
    }
    
    const history = getChatHistory(50);
    setCache(CACHE_KEYS.CHAT_HISTORY, history, CACHE_TTL.CHAT_HISTORY);
    
    res.json({ success: true, history, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get stats
app.get('/api/stats', verifyToken, (req, res) => {
  try {
    const cached = getCache(CACHE_KEYS.PICK_STATS);
    
    if (cached) {
      return res.json({ success: true, stats: cached, cached: true });
    }
    
    const stats = getPickStats();
    setCache(CACHE_KEYS.PICK_STATS, stats, CACHE_TTL.PICK_STATS);
    
    res.json({ success: true, stats, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scheduler controls
app.post('/api/scheduler/start', verifyToken, (req, res) => {
  try {
    startScheduler();
    res.json({ success: true, message: 'Scheduler started' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scheduler/stop', verifyToken, (req, res) => {
  try {
    stopScheduler();
    res.json({ success: true, message: 'Scheduler stopped' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scheduler/status', verifyToken, (req, res) => {
  try {
    const status = getSchedulerStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scheduler/logs', verifyToken, (req, res) => {
  try {
    const logs = getSchedulerLogs(50);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cache management
app.post('/api/cache/clear', verifyToken, (req, res) => {
  try {
    clearCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/cache/stats', verifyToken, (req, res) => {
  try {
    const stats = getCacheStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API usage stats
app.get('/api/usage', verifyToken, (req, res) => {
  try {
    const gamblinaStats = getGamblinaUsageStats();
    const cacheStats = getCacheStats();
    
    // Estimate monthly API usage based on schedule
    const scansPerDay = 2; // 12 PM and 8 PM
    const scansPerMonth = scansPerDay * 30;
    const redditCallsPerScan = 2; // posts + comments
    const gamblinaCallsPerScan = 1;
    
    const estimatedMonthly = {
      reddit: {
        used: scansPerMonth * redditCallsPerScan,
        limit: 500000,
        percentage: ((scansPerMonth * redditCallsPerScan) / 500000 * 100).toFixed(2),
      },
      gamblina: {
        callsThisMonth: gamblinaStats.callsThisMonth,
        estimatedTotal: scansPerMonth,
        estimatedCost: `$${(scansPerMonth * 0.02).toFixed(2)}`,
      },
      cache: {
        hitRate: cacheStats.hitRate,
        savedRequests: cacheStats.hits,
      }
    };
    
    res.json({ success: true, usage: estimatedMonthly });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === BET TRACKING ENDPOINTS ===

// Update user action (HIT/TRACK/FADE/NONE)
app.post('/api/picks/:pickId/action', verifyToken, (req, res) => {
  try {
    const { action } = req.body; // 'hit', 'track', 'fade', 'none'
    updateUserAction(req.params.pickId, action);
    
    deleteCache(CACHE_KEYS.TODAY_PICKS);
    deleteCache('my_bets');
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get my bets (HIT + TRACK only)
app.get('/api/my-bets', verifyToken, (req, res) => {
  try {
    const cached = getCache('my_bets');
    
    if (cached) {
      return res.json({ success: true, picks: cached, cached: true });
    }
    
    const picks = getMyBets();
    setCache('my_bets', picks, 300);
    
    res.json({ success: true, picks, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === HISTORY ENDPOINTS ===

// Get available dates with picks
app.get('/api/history/dates', verifyToken, (req, res) => {
  try {
    const dates = getDatesWithPicks();
    res.json({ success: true, dates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get picks for a specific date
app.get('/api/history/date/:date', verifyToken, (req, res) => {
  try {
    const cacheKey = `history_date:${req.params.date}`;
    const cached = getCache(cacheKey);
    
    if (cached) {
      return res.json({ success: true, picks: cached, cached: true });
    }
    
    const picks = getPicksByDate(req.params.date);
    setCache(cacheKey, picks, 3600);
    
    res.json({ success: true, picks, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// === ADMIN ENDPOINTS ===

// Admin user management - Legacy endpoints (use /api/admin/* for new code)
app.get('/api/admin/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const users = getAllUsers();
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    if (!username || !password || !role) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const user = createUser(username, password, role);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/users/:userId/role', verifyToken, requireAdmin, (req, res) => {
  try {
    const { role } = req.body;
    updateUserRole(parseInt(req.params.userId), role);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/users/:userId', verifyToken, requireAdmin, (req, res) => {
  try {
    deleteUser(parseInt(req.params.userId));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Delete pick (admin only)
app.delete('/api/picks/:pickId', verifyToken, requireAdmin, (req, res) => {
  try {
    const result = deletePick(parseInt(req.params.pickId));
    
    if (result) {
      deleteCache(CACHE_KEYS.TODAY_PICKS);
      deleteCache(CACHE_KEYS.PICK_STATS);
      deleteCache('finished_picks');
      deleteCache('my_bets');
      
      res.json({ success: true, message: 'Pick deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Pick not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update game time (admin only)
app.post('/api/picks/:pickId/time', verifyToken, (req, res) => {
  try {
    const { gameTime, gameDate } = req.body;
    updateGameTime(req.params.pickId, gameTime, gameDate);
    
    deleteCache(CACHE_KEYS.TODAY_PICKS);
    deleteCache('my_bets');
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update result manually
app.post('/api/picks/:pickId/result', verifyToken, (req, res) => {
  try {
    const { result, notes } = req.body; // won/lost/push/pending
    
    if (!['won', 'lost', 'push', 'pending'].includes(result)) {
      return res.status(400).json({ success: false, error: 'Invalid result' });
    }
    
    const updated = updatePickResult(parseInt(req.params.pickId), result, notes || null);
    
    if (updated) {
      deleteCache(CACHE_KEYS.TODAY_PICKS);
      deleteCache(CACHE_KEYS.PICK_STATS);
      deleteCache('finished_picks');
      deleteCache('my_bets');
      deleteCache('history_potds');
      
      res.json({ 
        success: true,
        message: `Pick result updated to: ${result}`,
        pickId: req.params.pickId,
        result: result
      });
    } else {
      res.status(404).json({ success: false, error: 'Pick not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean duplicates (admin tool)
app.post('/api/admin/clean-duplicates', verifyToken, (req, res) => {
  try {
    removeDuplicates();
    clearCache();
    res.json({ success: true, message: 'Duplicates removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 PICKSYNC BACKEND v2.0 (GAMBLINA FILTERING)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`👤 Admin: ${process.env.ADMIN_USERNAME}`);
  console.log(`🔐 Password: ${process.env.ADMIN_PASSWORD}`);
  console.log(`⏰ Scheduler: ${process.env.ENABLE_SCHEDULER !== 'false' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`💾 Caching: ENABLED (${CACHE_TTL.TODAY_PICKS}s TTL)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 GAMBLINA INTELLIGENT FILTERING:');
  console.log(`   Reddit: Fetch ALL comments (no limit)`);
  console.log(`   GAMBLINA: Filters & ranks ALL comments by statistics`);
  console.log(`   Scans: ${process.env.SCAN_TIMES || '2x daily'}`);
  console.log(`   Cache: ${CACHE_TTL.TODAY_PICKS}s (reduces API calls)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ESTIMATED MONTHLY USAGE:');
  console.log('   Reddit API: ~120 calls/month (0.024% of limit)');
  console.log('   GAMBLINA API: ~60 calls/month');
  console.log('   Tokens: ~180K-480K/month (depends on comment volume)');
  console.log('   Estimated Cost: ~$3-8/month');
  console.log('   Cache hit rate: Target >70%');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⏸️  Shutting down gracefully...');
  stopScheduler();
  optimizeDatabase();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⏸️  Shutting down gracefully...');
  stopScheduler();
  optimizeDatabase();
  process.exit(0);
});
