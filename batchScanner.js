// Batch-by-batch scanner to avoid Vercel timeouts
import { getPOTDData } from './reddit.js';
import { analyzeWithGamblina } from './gamblina.js';
import { saveScan, savePicksForScan } from './database.js';
import { setCache, getCache, deleteCache } from './cache.js';

const BATCH_SIZE = 15;

// Step 1: Start scan - fetch comments and cache them
export async function startBatchScan() {
  console.log('🚀 Starting batch scan - fetching Reddit comments...');
  
  const scanId = `scan_${Date.now()}`;
  const potdData = await getPOTDData();
  
  const numBatches = Math.ceil(potdData.allComments.length / BATCH_SIZE);
  
  // Cache the comments for batch processing
  setCache(`scan:${scanId}:comments`, potdData.allComments, 3600);
  setCache(`scan:${scanId}:metadata`, {
    scanId,
    title: potdData.title,
    url: potdData.url,
    totalComments: potdData.totalComments,
    numBatches,
    startTime: Date.now(),
  }, 3600);
  
  console.log(`✅ Scan ${scanId} started - ${numBatches} batches queued`);
  
  return {
    scanId,
    numBatches,
    totalComments: potdData.totalComments,
    title: potdData.title,
  };
}

// Step 2: Process a single batch
export async function processBatch(scanId, batchNum) {
  console.log(`📦 Processing batch ${batchNum} for scan ${scanId}...`);
  
  // Get cached comments
  const allComments = getCache(`scan:${scanId}:comments`);
  const metadata = getCache(`scan:${scanId}:metadata`);
  
  if (!allComments || !metadata) {
    throw new Error('Scan data not found - scan may have expired');
  }
  
  const numBatches = metadata.numBatches;
  const start = (batchNum - 1) * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, allComments.length);
  const batchComments = allComments.slice(start, end);
  
  console.log(`   Comments ${start + 1}-${end} of ${allComments.length}`);
  
  // Analyze with Gamblina
  const { analyzedPicks, tokensUsed } = await analyzeWithGamblina(batchComments);
  
  console.log(`✅ Batch ${batchNum}: ${analyzedPicks.length} picks extracted`);
  
  // Save picks to database immediately
  if (analyzedPicks.length > 0) {
    await savePicksForScan(scanId, analyzedPicks);
    console.log(`💾 Saved ${analyzedPicks.length} picks to database`);
  }
  
  // Check if this is the last batch
  const isLastBatch = batchNum >= numBatches;
  
  if (isLastBatch) {
    // Finalize scan
    const duration = Date.now() - metadata.startTime;
    
    // Get total picks saved
    const allPicksCache = getCache(`scan:${scanId}:allPicks`) || [];
    const totalPicks = allPicksCache.length + analyzedPicks.length;
    
    saveScan({
      id: scanId,
      potdTitle: metadata.title,
      potdUrl: metadata.url,
      totalComments: metadata.totalComments,
      totalPicks,
      scanDuration: duration,
      status: 'completed',
    });
    
    // Clean up cache
    deleteCache(`scan:${scanId}:comments`);
    deleteCache(`scan:${scanId}:metadata`);
    deleteCache(`scan:${scanId}:allPicks`);
    deleteCache('picks:today');
    
    console.log(`🎉 Scan ${scanId} completed! Total picks: ${totalPicks}`);
  } else {
    // Store picks count for final tally
    const allPicksCache = getCache(`scan:${scanId}:allPicks`) || [];
    allPicksCache.push(...analyzedPicks);
    setCache(`scan:${scanId}:allPicks`, allPicksCache, 3600);
  }
  
  return {
    batchNum,
    numBatches,
    picks: analyzedPicks,
    tokensUsed,
    done: isLastBatch,
  };
}

// Get scan progress
export function getBatchScanStatus(scanId) {
  const metadata = getCache(`scan:${scanId}:metadata`);
  
  if (!metadata) {
    return { exists: false };
  }
  
  const allPicksCache = getCache(`scan:${scanId}:allPicks`) || [];
  
  return {
    exists: true,
    scanId: metadata.scanId,
    numBatches: metadata.numBatches,
    totalComments: metadata.totalComments,
    picksExtracted: allPicksCache.length,
    startTime: metadata.startTime,
  };
}
