import Database from 'better-sqlite3';

const db = new Database('picksync.db');

// Track last scanned comment for incremental updates
const scanState = {
  lastCommentId: null,
  lastScanTime: null
};

// Track current scan status for polling
let currentScanStatus = {
  scanning: false,
  step: 'idle',
  progress: 0,
  details: '',
  error: null,
  lastUpdate: Date.now(),
  startTime: null,
  totalSteps: 5
};

// Update scan status (for real-time polling)
export function updateScanStatus(step, progress, details = '') {
  currentScanStatus = {
    scanning: progress < 100,
    step,
    progress,
    details,
    error: null,
    lastUpdate: Date.now(),
    startTime: currentScanStatus.startTime || Date.now(),
    totalSteps: 5
  };
  console.log(`📊 Scan Status: [${progress}%] ${step} - ${details}`);
}

// Set scan error
export function setScanError(error) {
  currentScanStatus = {
    ...currentScanStatus,
    scanning: false,
    error: error.message || 'Unknown error',
    lastUpdate: Date.now()
  };
  console.error(`❌ Scan Error: ${error.message}`);
}

// Get current scan status
export function getScanStatus() {
  return {
    ...currentScanStatus,
    elapsedTime: currentScanStatus.startTime 
      ? Math.floor((Date.now() - currentScanStatus.startTime) / 1000)
      : 0
  };
}

// Reset scan status
export function resetScanStatus() {
  currentScanStatus = {
    scanning: false,
    step: 'idle',
    progress: 0,
    details: '',
    error: null,
    lastUpdate: Date.now(),
    startTime: null,
    totalSteps: 5
  };
}

// Save scan state
export function saveScanState(commentId) {
  scanState.lastCommentId = commentId;
  scanState.lastScanTime = Date.now();
  
  // Persist to database
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO scan_state (id, last_comment_id, last_scan_time)
    VALUES (1, ?, ?)
  `);
  stmt.run(commentId, scanState.lastScanTime);
}

// Get last scan state
export function getLastScanState() {
  try {
    const stmt = db.prepare(`
      SELECT * FROM scan_state WHERE id = 1
    `);
    const state = stmt.get();
    
    if (state) {
      scanState.lastCommentId = state.last_comment_id;
      scanState.lastScanTime = state.last_scan_time;
    }
    
    return scanState;
  } catch (e) {
    // Table doesn't exist yet
    return { lastCommentId: null, lastScanTime: null };
  }
}

// Filter only new comments (for incremental updates)
export function filterNewComments(allComments) {
  const state = getLastScanState();
  
  if (!state.lastCommentId) {
    // First scan - return all
    console.log('📝 First scan - processing all comments');
    return allComments;
  }
  
  // Find index of last scanned comment
  const lastIndex = allComments.findIndex(c => c.id === state.lastCommentId);
  
  if (lastIndex === -1) {
    // Last comment not found - might be deleted or old thread
    console.log('⚠️ Last scanned comment not found - processing all');
    return allComments;
  }
  
  // Return only NEW comments (before the last scanned one)
  const newComments = allComments.slice(0, lastIndex);
  
  console.log(`📊 Incremental update: ${newComments.length} new comments (${allComments.length} total)`);
  
  return newComments;
}

// Initialize scan state table
export function initScanStateTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_state (
        id INTEGER PRIMARY KEY,
        last_comment_id TEXT,
        last_scan_time INTEGER
      )
    `);
    console.log('✅ Scan state table initialized');
  } catch (e) {
    console.error('⚠️ Scan state table error:', e.message);
  }
}
