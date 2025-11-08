import NodeCache from 'node-cache';

// Cache configuration from environment
const defaultTTL = parseInt(process.env.CACHE_TTL_PICKS) || 900;

const cache = new NodeCache({
  stdTTL: defaultTTL,
  checkperiod: 120,
  useClones: false,
});

// Cache keys
export const CACHE_KEYS = {
  TODAY_PICKS: 'picks:today',
  PICK_STATS: 'stats:picks',
  RECENT_SCANS: 'scans:recent',
  CHAT_HISTORY: 'chat:history',
  SCHEDULER_STATUS: 'scheduler:status',
};

// Cache durations from environment (OPTIMIZED for cost savings)
export const CACHE_TTL = {
  TODAY_PICKS: parseInt(process.env.CACHE_TTL_PICKS) || 900, // 15 min
  PICK_STATS: parseInt(process.env.CACHE_TTL_STATS) || 1800, // 30 min
  RECENT_SCANS: parseInt(process.env.CACHE_TTL_ARCHIVES) || 3600, // 60 min
  CHAT_HISTORY: 300, // 5 min
  SCHEDULER_STATUS: 60, // 1 min
};

// Get from cache
export function getCache(key) {
  try {
    const value = cache.get(key);
    if (value !== undefined) {
      if (process.env.VERBOSE_LOGGING === 'true') {
        console.log(`💾 Cache HIT: ${key}`);
      }
      return value;
    }
    if (process.env.VERBOSE_LOGGING === 'true') {
      console.log(`❌ Cache MISS: ${key}`);
    }
    return null;
  } catch (error) {
    console.error(`❌ Cache GET error for ${key}:`, error.message);
    return null;
  }
}

// Set cache with custom TTL
export function setCache(key, value, ttl = null) {
  try {
    const success = cache.set(key, value, ttl || CACHE_TTL[key] || defaultTTL);
    if (success && process.env.VERBOSE_LOGGING === 'true') {
      console.log(`✅ Cache SET: ${key} (TTL: ${ttl || CACHE_TTL[key] || defaultTTL}s)`);
    }
    return success;
  } catch (error) {
    console.error(`❌ Cache SET error for ${key}:`, error.message);
    return false;
  }
}

// Delete from cache
export function deleteCache(key) {
  try {
    const count = cache.del(key);
    if (count > 0 && process.env.VERBOSE_LOGGING === 'true') {
      console.log(`🗑️  Cache DELETE: ${key}`);
    }
    return count;
  } catch (error) {
    console.error(`❌ Cache DELETE error for ${key}:`, error.message);
    return 0;
  }
}

// Clear all cache
export function clearCache() {
  try {
    cache.flushAll();
    console.log('🗑️  All cache cleared');
    return true;
  } catch (error) {
    console.error('❌ Cache CLEAR error:', error.message);
    return false;
  }
}

// Get cache stats
export function getCacheStats() {
  const stats = cache.getStats();
  const keys = cache.keys();
  
  return {
    keys: keys.length,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0,
    keysDetail: keys.map(key => ({
      key,
      ttl: cache.getTtl(key),
    })),
  };
}

// Cache warmer - preload common queries
export async function warmCache(database) {
  console.log('🔥 Warming cache...');
  
  try {
    const todayPicks = database.getTodaysPicks();
    setCache(CACHE_KEYS.TODAY_PICKS, todayPicks, CACHE_TTL.TODAY_PICKS);
    
    const stats = database.getPickStats();
    setCache(CACHE_KEYS.PICK_STATS, stats, CACHE_TTL.PICK_STATS);
    
    const recentScans = database.getAllScans(10);
    setCache(CACHE_KEYS.RECENT_SCANS, recentScans, CACHE_TTL.RECENT_SCANS);
    
    console.log('✅ Cache warmed successfully');
  } catch (error) {
    console.error('❌ Cache warming failed:', error.message);
  }
}

export default cache;
