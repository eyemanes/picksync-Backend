import Database from 'better-sqlite3';

const db = new Database('picksync.db');

// Optimize SQLite for better performance
db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
db.pragma('synchronous = NORMAL'); // Faster writes with safety
db.pragma('cache_size = 10000'); // 10MB cache
db.pragma('temp_store = MEMORY'); // Keep temp tables in memory

// 🔧 HELPER: Extract POTD date from title
function extractPOTDDate(potdTitle) {
  const datePatterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,  // 11/8/24 or 11/08/2024
    /(\d{1,2}-\d{1,2}-\d{2,4})/,   // 11-8-24
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i,  // Nov 8
    /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i  // 8 Nov
  ];
  
  for (const pattern of datePatterns) {
    const match = potdTitle.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return new Date().toLocaleDateString('en-US');
}

// Create all tables with improved schema
export function initDatabase() {
  try {
    // Check if migration is needed
    const columns = db.pragma('table_info(scans)');
    const hasPotdDate = columns.some(col => col.name === 'potd_date');
    const hasIsCurrent = columns.some(col => col.name === 'is_current');
    
    if (!hasPotdDate || !hasIsCurrent) {
      console.log('⚠️  WARNING: Database needs migration!');
      console.log('   Run: node run-migration.js');
      console.log('   Missing columns:', !hasPotdDate ? 'potd_date' : '', !hasIsCurrent ? 'is_current' : '');
    }
    
    // Picks table with comprehensive tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        rank INTEGER,
        confidence INTEGER,
        
        -- Game info
        sport TEXT,
        teams TEXT,
        game_time TEXT,
        game_date TEXT,
        
        -- Pick details
        pick TEXT,
        risk_level TEXT,
        
        -- Poster info
        poster TEXT,
        poster_record TEXT,
        poster_win_rate TEXT,
        comment_score INTEGER DEFAULT 0,
        
        -- Analysis
        original_comment TEXT,
        reasoning TEXT,
        key_factors TEXT,
        
        -- User Actions
        user_action TEXT DEFAULT 'none',
        action_timestamp DATETIME,
        
        -- Tracking
        result TEXT DEFAULT 'pending',
        actual_outcome TEXT,
        notes TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Scans table with POTD date tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        potd_title TEXT,
        potd_url TEXT,
        potd_date TEXT,
        total_comments INTEGER,
        total_picks INTEGER,
        scan_duration_ms INTEGER,
        status TEXT DEFAULT 'completed',
        is_current INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Chat history with AI
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_message TEXT,
        ai_response TEXT,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Scheduler log for tracking automated scans
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        scan_id TEXT,
        success BOOLEAN,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_picks_scan ON picks(scan_id);
      CREATE INDEX IF NOT EXISTS idx_picks_date ON picks(game_date DESC);
      CREATE INDEX IF NOT EXISTS idx_picks_sport ON picks(sport);
      CREATE INDEX IF NOT EXISTS idx_picks_result ON picks(result);
      CREATE INDEX IF NOT EXISTS idx_picks_created ON picks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_scans_current ON scans(is_current);
      CREATE INDEX IF NOT EXISTS idx_scans_potd_date ON scans(potd_date);
      CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_history(created_at DESC);
    `);

    console.log('✅ Database initialized (SQLite with WAL mode)');
  } catch (error) {
    console.error('❌ Database init error:', error.message);
  }
}

// 🆕 Save a new scan with POTD date tracking
export function saveScan(scanData) {
  const potdDate = extractPOTDDate(scanData.potdTitle);
  
  const existingScan = db.prepare(`
    SELECT id, potd_date FROM scans WHERE potd_date = ?
  `).get(potdDate);
  
  if (existingScan) {
    console.log(`ℹ️  Same POTD date (${potdDate}) - DELETING all old same-day scans`);
    
    // Get all scan IDs for this date
    const oldScans = db.prepare('SELECT id FROM scans WHERE potd_date = ?').all(potdDate);
    
    // Delete picks for all old scans
    for (const scan of oldScans) {
      db.prepare('DELETE FROM picks WHERE scan_id = ?').run(scan.id);
    }
    
    // Delete all scans for this date
    db.prepare('DELETE FROM scans WHERE potd_date = ?').run(potdDate);
    
    console.log(`🗑️  Deleted ${oldScans.length} old scans for ${potdDate}`);
  } else {
    console.log(`🆕 New POTD detected (${potdDate}) - moving old POTD to history`);
    
    // Mark ALL old scans as not current (they go to history)
    db.prepare('UPDATE scans SET is_current = 0').run();
  }
  
  // ALWAYS insert the new scan as current
  const stmt = db.prepare(`
    INSERT INTO scans (id, potd_title, potd_url, potd_date, total_comments, total_picks, scan_duration_ms, status, is_current)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  
  stmt.run(
    scanData.id,
    scanData.potdTitle,
    scanData.potdUrl,
    potdDate,
    scanData.totalComments,
    scanData.totalPicks,
    scanData.scanDuration || 0,
    scanData.status || 'completed'
  );
  
  console.log(`✅ Scan ${scanData.id} saved as CURRENT for ${potdDate}`);
  
  return { scanId: scanData.id, isNewPOTD: !existingScan, potdDate };
}

// 🆕 Save picks with duplicate prevention
export function savePicksForScan(scanId, picks) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO picks (
      scan_id, rank, confidence,
      sport, teams, game_time, game_date, pick, risk_level,
      poster, poster_record, poster_win_rate, comment_score,
      original_comment, reasoning, key_factors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const checkDuplicate = db.prepare(`
    SELECT id FROM picks 
    WHERE scan_id = ? AND poster = ? AND teams = ? AND pick = ?
  `);

  const insertMany = db.transaction((picks) => {
    let inserted = 0;
    let skipped = 0;
    
    for (const pick of picks) {
      const existing = checkDuplicate.get(
        scanId,
        pick.poster || '',
        pick.teams || '',
        pick.pick || ''
      );
      
      if (existing) {
        skipped++;
        continue;
      }
      
      stmt.run(
        scanId,
        pick.rank || 0,
        pick.confidence || 0,
        pick.sport || '',
        pick.teams || '',
        pick.gameTime || '',
        pick.gameDate || '',
        pick.pick || '',
        pick.riskLevel || 'medium',
        pick.poster || '',
        pick.posterRecord || '',
        pick.posterWinRate || '',
        pick.commentScore || 0,
        pick.originalComment || '',
        pick.reasoning || '',
        JSON.stringify(pick.keyFactors || [])
      );
      inserted++;
    }
    
    return { inserted, skipped };
  });

  const result = insertMany(picks);
  console.log(`✅ Saved ${result.inserted} picks (${result.skipped} duplicates skipped)`);
  return result;
}

export function getAllScans(limit = 50, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM scans 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset);
}

// 🆕 Get CURRENT POTD picks only (Dashboard)
export function getCurrentPOTDPicks() {
  let currentScan;
  
  try {
    const currentScanStmt = db.prepare(`
      SELECT id, potd_title, potd_date FROM scans 
      WHERE is_current = 1 
      LIMIT 1
    `);
    
    currentScan = currentScanStmt.get();
  } catch (error) {
    // Column doesn't exist yet - fallback to getTodaysPicks behavior
    console.log('⚠️  Using fallback - run migration: node run-migration.js');
    const today = new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      SELECT * FROM picks 
      WHERE DATE(created_at) = ?
      ORDER BY rank ASC
    `);
    const picks = stmt.all(today);
    
    return {
      picks: picks.map(pick => ({
        ...pick,
        keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
      })),
      potdTitle: '',
      potdDate: '',
      scanId: ''
    };
  }
  
  if (!currentScan) {
    return { picks: [], potdTitle: '', potdDate: '', scanId: '' };
  }
  
  const picksStmt = db.prepare(`
    SELECT * FROM picks 
    WHERE scan_id = ?
    ORDER BY confidence DESC, rank ASC
  `);
  
  const picks = picksStmt.all(currentScan.id);
  
  return {
    picks: picks.map(pick => ({
      ...pick,
      keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
    })),
    potdTitle: currentScan.potd_title,
    potdDate: currentScan.potd_date,
    scanId: currentScan.id
  };
}

// 🆕 Get HISTORY POTDs (all old POTDs) - GROUPED BY DATE
export function getHistoryPOTDs() {
  const stmt = db.prepare(`
    SELECT 
      s.id, 
      s.potd_title, 
      s.potd_date,
      s.created_at,
      COUNT(p.id) as actual_picks
    FROM scans s
    LEFT JOIN picks p ON s.id = p.scan_id
    WHERE s.is_current = 0
    AND s.id IN (
      -- Get the LATEST scan for each potd_date
      SELECT s2.id 
      FROM scans s2
      WHERE s2.is_current = 0
      GROUP BY s2.potd_date
      HAVING s2.created_at = MAX(s2.created_at)
    )
    GROUP BY s.potd_date
    ORDER BY s.created_at DESC
  `);
  return stmt.all();
}

export function getPicksByScanId(scanId) {
  const stmt = db.prepare(`
    SELECT * FROM picks 
    WHERE scan_id = ? 
    ORDER BY confidence DESC, rank ASC
  `);
  const picks = stmt.all(scanId);
  
  return picks.map(pick => ({
    ...pick,
    keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
  }));
}

export function getTodaysPicks() {
  return getCurrentPOTDPicks();
}

export function getFinishedPicks(limit = 100) {
  const stmt = db.prepare(`
    SELECT * FROM picks 
    WHERE result != 'pending'
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const picks = stmt.all(limit);
  
  return picks.map(pick => ({
    ...pick,
    keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
  }));
}

// 🆕 Update pick result - NOW WORKS EVERYWHERE
export function updatePickResult(pickId, result, notes = null) {
  const stmt = db.prepare(`
    UPDATE picks 
    SET result = ?, notes = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  const info = stmt.run(result, notes, pickId);
  
  console.log(`✅ Pick ${pickId} result updated to: ${result}`);
  return info.changes > 0;
}

export function saveChatMessage(userMessage, aiResponse, context = null) {
  const stmt = db.prepare(`
    INSERT INTO chat_history (user_message, ai_response, context)
    VALUES (?, ?, ?)
  `);
  stmt.run(userMessage, aiResponse, context ? JSON.stringify(context) : null);
}

export function getChatHistory(limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM chat_history 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(limit);
}

export function getPickStats() {
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
      SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
      SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as push,
      SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending,
      ROUND(AVG(CASE WHEN result = 'won' THEN confidence ELSE NULL END), 1) as avg_confidence_won,
      ROUND(AVG(CASE WHEN result = 'lost' THEN confidence ELSE NULL END), 1) as avg_confidence_lost,
      ROUND(AVG(confidence), 1) as avg_confidence_all,
      COUNT(DISTINCT sport) as total_sports,
      COUNT(DISTINCT poster) as total_posters
    FROM picks
    WHERE result != 'pending'
  `);
  
  const overall = stmt.get();
  
  const sportStatsStmt = db.prepare(`
    SELECT 
      sport,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
      SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost
    FROM picks
    WHERE result != 'pending'
    GROUP BY sport
    ORDER BY total DESC
  `);
  
  const bySport = sportStatsStmt.all();
  
  const posterStatsStmt = db.prepare(`
    SELECT 
      poster,
      COUNT(*) as total,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
      ROUND(AVG(confidence), 1) as avg_confidence
    FROM picks
    WHERE result != 'pending'
    GROUP BY poster
    ORDER BY won DESC
    LIMIT 10
  `);
  
  const topPosters = posterStatsStmt.all();
  
  return {
    overall,
    bySport,
    topPosters,
  };
}

export function logSchedulerEvent(eventType, scanId, success, message) {
  const stmt = db.prepare(`
    INSERT INTO scheduler_log (event_type, scan_id, success, message)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(eventType, scanId, success ? 1 : 0, message);
}

export function getSchedulerLogs(limit = 20) {
  const stmt = db.prepare(`
    SELECT * FROM scheduler_log
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export function cleanOldData(daysToKeep = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString();
  
  const deleteOldPicks = db.prepare(`
    DELETE FROM picks WHERE created_at < ?
  `);
  
  const deleteOldScans = db.prepare(`
    DELETE FROM scans WHERE created_at < ?
  `);
  
  const deleteOldLogs = db.prepare(`
    DELETE FROM scheduler_log WHERE created_at < ?
  `);
  
  const transaction = db.transaction(() => {
    const picks = deleteOldPicks.run(cutoff);
    const scans = deleteOldScans.run(cutoff);
    const logs = deleteOldLogs.run(cutoff);
    
    return { picks: picks.changes, scans: scans.changes, logs: logs.changes };
  });
  
  return transaction();
}

export function optimizeDatabase() {
  db.exec('VACUUM');
  db.exec('ANALYZE');
  console.log('✅ Database optimized');
}

export function updateUserAction(pickId, action) {
  const stmt = db.prepare(`
    UPDATE picks 
    SET user_action = ?, action_timestamp = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  const info = stmt.run(action, pickId);
  return info.changes > 0;
}

export function updateGameTime(pickId, gameTime, gameDate) {
  const stmt = db.prepare(`
    UPDATE picks 
    SET game_time = ?, game_date = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  stmt.run(gameTime, gameDate, pickId);
}

export function getPicksByAction(action) {
  const stmt = db.prepare(`
    SELECT * FROM picks 
    WHERE user_action = ? 
    ORDER BY created_at DESC
  `);
  const picks = stmt.all(action);
  
  return picks.map(pick => ({
    ...pick,
    keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
  }));
}

export function getMyBets() {
  const stmt = db.prepare(`
    SELECT p.*, s.potd_title, s.potd_date
    FROM picks p
    LEFT JOIN scans s ON p.scan_id = s.id
    WHERE p.user_action IN ('hit', 'track', 'fade')
    ORDER BY p.action_timestamp DESC
  `);
  const picks = stmt.all();
  
  return picks.map(pick => ({
    ...pick,
    keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
  }));
}

export function getPicksByDate(date) {
  const stmt = db.prepare(`
    SELECT * FROM picks 
    WHERE DATE(created_at) = ?
    ORDER BY confidence DESC, rank ASC
  `);
  const picks = stmt.all(date);
  
  return picks.map(pick => ({
    ...pick,
    keyFactors: pick.key_factors ? JSON.parse(pick.key_factors) : []
  }));
}

export function getDatesWithPicks() {
  const stmt = db.prepare(`
    SELECT DISTINCT DATE(created_at) as date, COUNT(*) as count
    FROM picks 
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 30
  `);
  return stmt.all();
}

// 🧹 Remove duplicate picks
export function removeDuplicates() {
  const transaction = db.transaction(() => {
    const duplicates = db.prepare(`
      SELECT poster, teams, pick, scan_id, COUNT(*) as count
      FROM picks
      GROUP BY poster, teams, pick, scan_id
      HAVING COUNT(*) > 1
    `).all();
    
    console.log(`🔍 Found ${duplicates.length} duplicate groups`);
    
    if (duplicates.length > 0) {
      for (const dup of duplicates) {
        db.prepare(`
          DELETE FROM picks 
          WHERE id NOT IN (
            SELECT MIN(id) 
            FROM picks 
            WHERE poster = ? AND teams = ? AND pick = ? AND scan_id = ?
          )
          AND poster = ? AND teams = ? AND pick = ? AND scan_id = ?
        `).run(
          dup.poster, dup.teams, dup.pick, dup.scan_id,
          dup.poster, dup.teams, dup.pick, dup.scan_id
        );
      }
      console.log('✅ Removed duplicate picks');
    } else {
      console.log('✅ No duplicates found');
    }
  });
  
  return transaction();
}

export default db;

// Delete pick (admin only)
export function deletePick(pickId) {
  const result = db.prepare('DELETE FROM picks WHERE id = ?').run(pickId);
  return result.changes > 0;
}
