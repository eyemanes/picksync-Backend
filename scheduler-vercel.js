import cron from 'node-cron';
import { getPOTDData } from './reddit.js';
import { analyzeWithGamblina } from './gamblina.js';
import { saveScan, savePicksForScan, logSchedulerEvent } from './database.js';
import { updateScanStatus, setScanError, resetScanStatus } from './scanState.js';
import { clearCache, deleteCache, CACHE_KEYS } from './cache.js';

// Check if running on Vercel
const IS_VERCEL = process.env.VERCEL === '1';

// Scheduler configuration from environment or defaults
const SCAN_TIMES = process.env.SCAN_TIMES || '0 12,20 * * *'; // 12 PM, 8 PM daily

let schedulerTask = null;
let isRunning = false;

// Run a complete scan cycle
export async function runScan() {
  if (isRunning) {
    console.log('⏸️  Scan already in progress, skipping...');
    return { success: false, message: 'Scan already running' };
  }

  isRunning = true;
  const scanId = `scan_${Date.now()}`;
  const startTime = Date.now();

  console.log('\n🚀 AUTOMATED SCAN STARTED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📋 Scan ID: ${scanId}`);
  console.log(`⏰ Time: ${new Date().toLocaleString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Reset status
    resetScanStatus();
    
    // Step 1: Fetch POTD data from Reddit
    updateScanStatus('reddit', 20, 'Fetching POTD thread...');
    const potdData = await getPOTDData();
    updateScanStatus('reddit', 40, `Found ${potdData.totalComments} comments`);

    // Step 2: Analyze ALL comments with Gamblina (filtering + ranking)
    updateScanStatus('analysis', 50, 'Analyzing picks with AI...');
    const { analyzedPicks, tokensUsed } = await analyzeWithGamblina(potdData.allComments);
    updateScanStatus('analysis', 80, `Extracted ${analyzedPicks.length} quality picks`);

    // Step 3: Save to database
    updateScanStatus('database', 90, 'Saving picks...');
    const scanDuration = Date.now() - startTime;
    
    saveScan({
      id: scanId,
      potdTitle: potdData.title,
      potdUrl: potdData.url,
      totalComments: potdData.totalComments,
      totalPicks: analyzedPicks.length,
      scanDuration,
      status: 'completed',
    });

    await savePicksForScan(scanId, analyzedPicks);

    // CRITICAL: Clear all caches after saving new picks
    console.log('🗑️  Clearing all caches to force fresh data...');
    clearCache();
    deleteCache(CACHE_KEYS.TODAY_PICKS);
    deleteCache(CACHE_KEYS.PICK_STATS);
    deleteCache(CACHE_KEYS.RECENT_SCANS);
    deleteCache('history_potds');
    deleteCache('my_bets');
    deleteCache('finished_picks');
    console.log('✅ All caches cleared');

    // Log success
    logSchedulerEvent('scan', scanId, true, `Successfully analyzed ${analyzedPicks.length} picks in ${(scanDuration / 1000).toFixed(1)}s`);
    
    // Mark complete
    updateScanStatus('complete', 100, `Saved ${analyzedPicks.length} picks successfully`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ AUTOMATED SCAN COMPLETED');
    console.log(`   Duration: ${(scanDuration / 1000).toFixed(1)}s`);
    console.log(`   Picks Saved: ${analyzedPicks.length}`);
    console.log(`   Reddit Calls: ${potdData.apiCallsUsed || 2}`);
    console.log(`   Gamblina Calls: 1`);
    if (tokensUsed) {
      console.log(`   Tokens Used: ${tokensUsed}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    isRunning = false;

    return {
      success: true,
      scanId,
      picks: analyzedPicks,
      duration: scanDuration,
      totalComments: potdData.totalComments,
      apiCallsUsed: potdData.apiCallsUsed || 2,
    };

  } catch (error) {
    const scanDuration = Date.now() - startTime;
    
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ AUTOMATED SCAN FAILED');
    console.error(`   Error: ${error.message}`);
    console.error(`   Duration: ${(scanDuration / 1000).toFixed(1)}s`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Log failure
    logSchedulerEvent('scan', scanId, false, `Scan failed: ${error.message}`);
    
    // Set error status
    setScanError(error);

    isRunning = false;

    return {
      success: false,
      error: error.message,
      duration: scanDuration,
    };
  }
}

// Start the scheduler (disabled on Vercel)
export function startScheduler() {
  if (IS_VERCEL) {
    console.log('\n⏰ SCHEDULER DISABLED ON VERCEL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ℹ️  Use one of these alternatives:');
    console.log('   1. Vercel Cron Jobs (Pro plan)');
    console.log('   2. External cron service (cron-job.org)');
    console.log('   3. Manual scans only');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }
  
  if (schedulerTask) {
    console.log('⚠️  Scheduler already running');
    return;
  }

  console.log('\n⏰ SCHEDULER INITIALIZED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📅 Schedule: ${SCAN_TIMES}`);
  console.log('   (Cron format: minute hour day month weekday)');
  console.log('   → 12:00 PM - Afternoon scan');
  console.log('   → 8:00 PM - Evening scan');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Create scheduled task
  schedulerTask = cron.schedule(SCAN_TIMES, async () => {
    console.log('⏰ Scheduled scan triggered');
    await runScan();
  }, {
    timezone: process.env.TIMEZONE || "America/New_York"
  });

  logSchedulerEvent('scheduler', null, true, 'Scheduler started');
}

// Stop the scheduler
export function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logSchedulerEvent('scheduler', null, true, 'Scheduler stopped');
    console.log('⏸️  Scheduler stopped');
  }
}

// Get scheduler status
export function getSchedulerStatus() {
  return {
    active: !!schedulerTask,
    isRunning,
    schedule: SCAN_TIMES,
    timezone: process.env.TIMEZONE || "America/New_York",
    vercelMode: IS_VERCEL,
  };
}
