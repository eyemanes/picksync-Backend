// Simple in-memory rate limiter
const rateLimitStore = new Map();

/**
 * Simple rate limiter middleware
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} max - Max requests per window
 */
export function rateLimit(windowMs = 15 * 60 * 1000, max = 5) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Get or create rate limit entry
    let entry = rateLimitStore.get(key);
    
    if (!entry) {
      entry = { count: 0, resetTime: now + windowMs };
      rateLimitStore.set(key, entry);
    }
    
    // Reset if window expired
    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + windowMs;
    }
    
    // Increment counter
    entry.count++;
    
    // Check if limit exceeded
    if (entry.count > max) {
      const resetIn = Math.ceil((entry.resetTime - now) / 1000);
      console.log(`🚫 Rate limit hit for ${key}: ${entry.count}/${max} requests`);
      return res.status(429).json({
        success: false,
        error: `Too many requests. Try again in ${resetIn} seconds.`,
        retryAfter: resetIn,
      });
    }
    
    console.log(`✅ Rate limit OK for ${key}: ${entry.count}/${max} requests`);
    next();
  };
}

// Cleanup old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime + 3600000) { // 1 hour past reset
      rateLimitStore.delete(key);
    }
  }
  console.log(`🧹 Rate limiter cleanup: ${rateLimitStore.size} active IPs`);
}, 3600000);
