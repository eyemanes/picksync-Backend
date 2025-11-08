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

// Save scan state (in-memory for now, can be persisted to DB later)
export function saveScanState(commentId) {
  scanState.lastCommentId = commentId;
  scanState.lastScanTime = Date.now();
  console.log(`💾 Saved scan state: ${commentId}`);
}

// Get last scan state
export function getLastScanState() {
  return scanState;
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

// Initialize scan state table (no-op for in-memory, can be implemented for DB persistence)
export function initScanStateTable() {
  console.log('✅ Scan state initialized (in-memory)');
}
