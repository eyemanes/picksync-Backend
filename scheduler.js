import cron from 'node-cron';
import { getPOTDData } from './reddit.js';
import { analyzeWithGamblina } from './gamblina.js';
import { saveScan, savePicksForScan, logSchedulerEvent } from './database.js';
import { updateScanStatus, setScanError, resetScanStatus } from './scanState.js';
import { clearCache, deleteCache, CACHE_KEYS } from './cache.js';

const IS_VERCEL = process.env.VERCEL === '1';
const SCAN_TIMES = process.env.SCAN_TIMES || '0 12,20 * * *';

let schedulerTask = null;
let isRunning = false;

export async function runScan() {
  if (isRunning) {
    console.log('⏸️  Scan already in progress, skipping...');
    return { success: false, message: 'Scan already running' };
  }

  isRunning = true;
  const scanId = `scan_${Date.now()}`;
  const startTime = Date.now();

  console.log('\n🚀 AUTOMATED SCAN STARTED');
  console.log(`📋 Scan ID: ${scanId}`);
  console.log(`⏰ Time: ${new Date().toLocaleString()}`);

  try {
    resetScanStatus();
    
    updateScanStatus('reddit', 20, 'Fetching POTD thread...');
    const potdData = await getPOTDData();
    updateScanStatus('reddit', 40, `Found ${potdData.totalComments} comments`);

    updateScanStatus('analysis', 50, 'Analyzing picks with AI...');
    const { analyzedPicks, tokensUsed } = await analyzeWithGamblina(potdData.allComments);
    updateScanStatus('analysis', 80, `Extracted ${analyzedPicks.length} quality picks`);

    if (analyzedPicks.length === 0) {
      throw new Error('No picks extracted from comments');
    }

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

    console.log('🗑️  Clearing caches...');
    clearCache();
    deleteCache(CACHE_KEYS.TODAY_PICKS);
    deleteCache(CACHE_KEYS.PICK_STATS);
    deleteCache(CACHE_KEYS.RECENT_SCANS);
    deleteCache('history_potds');
    deleteCache('my_bets');
    deleteCache('finished_picks');
    console.log('✅ Caches cleared');

    logSchedulerEvent('scan', scanId, true, `Successfully analyzed ${analyzedPicks.length} picks in ${(scanDuration / 1000).toFixed(1)}s`);
    
    updateScanStatus('complete', 100, `Saved ${analyzedPicks.length} picks successfully`);

    console.log('\n✅ AUTOMATED SCAN COMPLETED');
    console.log(`   Duration: ${(scanDuration / 1000).toFixed(1)}s`);
    console.log(`   Picks Saved: ${analyzedPicks.length}`);
    console.log(`   Tokens Used: ${tokensUsed}\n`);

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
    
    console.error('\n❌ AUTOMATED SCAN FAILED');
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error(`   Duration: ${(scanDuration / 1000).toFixed(1)}s\n`);

    logSchedulerEvent('scan', scanId, false, `Scan failed: ${error.message}`);
    
    setScanError(error);

    isRunning = false; // ALWAYS reset flag

    return {
      success: false,
      error: error.message,
      duration: scanDuration,
    };
  }
}

export function startScheduler() {
  if (IS_VERCEL) {
    console.log('\n⏰ SCHEDULER DISABLED ON VERCEL');
    console.log('ℹ️  Use Vercel Cron Jobs or external service\n');
    return;
  }
  
  if (schedulerTask) {
    console.log('⚠️  Scheduler already running');
    return;
  }

  console.log('\n⏰ SCHEDULER INITIALIZED');
  console.log(`📅 Schedule: ${SCAN_TIMES}\n`);

  schedulerTask = cron.schedule(SCAN_TIMES, async () => {
    console.log('⏰ Scheduled scan triggered');
    await runScan();
  }, {
    timezone: process.env.TIMEZONE || "America/New_York"
  });

  logSchedulerEvent('scheduler', null, true, 'Scheduler started');
}

export function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logSchedulerEvent('scheduler', null, true, 'Scheduler stopped');
    console.log('⏸️  Scheduler stopped');
  }
}

export function getSchedulerStatus() {
  return {
    active: !!schedulerTask,
    isRunning,
    schedule: SCAN_TIMES,
    timezone: process.env.TIMEZONE || "America/New_York",
    vercelMode: IS_VERCEL,
  };
}
