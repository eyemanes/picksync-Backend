// NEW ENDPOINTS TO ADD TO server.js

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
    updatePickResult(req.params.pickId, result, notes);
    
    deleteCache(CACHE_KEYS.TODAY_PICKS);
    deleteCache(CACHE_KEYS.PICK_STATS);
    deleteCache('finished_picks');
    deleteCache('my_bets');
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// INSTRUCTIONS:
// 1. Copy these endpoints
// 2. Paste before "// Error handling" in server.js (around line 400)
// 3. Make sure imports are added at top:
//    - updateUserAction, updateGameTime, getMyBets, getPicksByDate, getDatesWithPicks
