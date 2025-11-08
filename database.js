// Database wrapper - works with SQLite (local) and Neon Postgres (Vercel)
import Database from 'better-sqlite3';
import pkg from 'pg';
const { Pool } = pkg;

const IS_VERCEL = process.env.VERCEL === '1' || process.env.DATABASE_URL?.includes('postgres');

let db;
let pool;

if (IS_VERCEL) {
  console.log('🔗 Using Neon Postgres (Production)');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 20, // Max connections in pool
    idleTimeoutMillis: 30000, // Close idle clients after 30s
    connectionTimeoutMillis: 10000, // Wait max 10s for connection
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000
  });
  
  // Handle pool errors
  pool.on('error', (err) => {
    console.error('❌ Postgres pool error:', err);
  });
} else {
  console.log('🔗 Using SQLite (Local Development)');
  db = new Database('picksync.db');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 10000');
  db.pragma('temp_store = MEMORY');
}

// Helper to run queries WITH RETRY
async function query(sqlQuery, params = [], retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (IS_VERCEL) {
        let paramIndex = 1;
        const pgQuery = sqlQuery.replace(/\?/g, () => `$${paramIndex++}`);
        const result = await pool.query(pgQuery, params);
        return result.rows;
      } else {
        if (sqlQuery.toLowerCase().includes('select')) {
          return db.prepare(sqlQuery).all(...params);
        } else {
          return db.prepare(sqlQuery).run(...params);
        }
      }
    } catch (error) {
      if (attempt === retries || !error.message.includes('Connection') && !error.message.includes('timeout')) {
        throw error;
      }
      console.warn(`⚠️  Query attempt ${attempt} failed, retrying... (${error.message})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Helper to get a single row WITH RETRY
async function queryOne(sqlQuery, params = [], retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (IS_VERCEL) {
        let paramIndex = 1;
        const pgQuery = sqlQuery.replace(/\?/g, () => `$${paramIndex++}`);
        const result = await pool.query(pgQuery, params);
        return result.rows[0];
      } else {
        return db.prepare(sqlQuery).get(...params);
      }
    } catch (error) {
      if (attempt === retries || !error.message.includes('Connection') && !error.message.includes('timeout')) {
        throw error;
      }
      console.warn(`⚠️  Query attempt ${attempt} failed, retrying... (${error.message})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// 🔧 HELPER: Extract POTD date from title
function extractPOTDDate(potdTitle) {
  const datePatterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    /(\d{1,2}-\d{1,2}-\d{2,4})/,
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i,
    /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i
  ];
  
  for (const pattern of datePatterns) {
    const match = potdTitle.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return new Date().toLocaleDateString('en-US');
}

// Initialize database
export async function initDatabase() {
  try {
    if (IS_VERCEL) {
      console.log('✅ Database initialized (Neon Postgres)');
      return;
    }
    
    // SQLite initialization
    db.exec(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        potd_title TEXT,
        potd_url TEXT,
        potd_date TEXT,
        scan_date DATE,
        total_comments INTEGER,
        total_picks INTEGER,
        scan_duration INTEGER,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_current BOOLEAN DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        scan_date DATE,
        rank INTEGER,
        confidence INTEGER,
        sport TEXT,
        event TEXT,
        pick TEXT,
        odds TEXT,
        units REAL,
        comment_score INTEGER,
        comment_author TEXT,
        comment_body TEXT,
        comment_url TEXT,
        reasoning TEXT,
        risk_factors TEXT,
        ai_analysis TEXT,
        user_record TEXT,
        result TEXT DEFAULT 'pending',
        result_notes TEXT,
        user_action TEXT DEFAULT 'none',
        game_time TEXT,
        game_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_message TEXT,
        ai_response TEXT,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scheduler_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT,
        scan_id TEXT,
        success INTEGER,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_picks_scan_id ON picks(scan_id);
      CREATE INDEX IF NOT EXISTS idx_picks_scan_date ON picks(scan_date);
      CREATE INDEX IF NOT EXISTS idx_picks_result ON picks(result);
      CREATE INDEX IF NOT EXISTS idx_picks_user_action ON picks(user_action);
      CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date);
      CREATE INDEX IF NOT EXISTS idx_scans_potd_date ON scans(potd_date);
      CREATE INDEX IF NOT EXISTS idx_scans_current ON scans(is_current);
    `);

    console.log('✅ Database initialized (SQLite with WAL mode)');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Get all scans
export async function getAllScans(limit = 50, offset = 0) {
  return await query(
    `SELECT id, potd_title, scan_date, potd_date, total_picks, status, created_at, is_current
     FROM scans 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

// Get picks by scan ID
export async function getPicksByScanId(scanId) {
  return await query(
    `SELECT * FROM picks WHERE scan_id = ? ORDER BY confidence DESC, rank ASC`,
    [scanId]
  );
}

// Get today's picks (SQLite only)
export function getTodaysPicks() {
  if (IS_VERCEL) {
    throw new Error('Use getCurrentPOTDPicks() for Vercel');
  }
  
  return db.prepare(`
    SELECT p.* 
    FROM picks p
    INNER JOIN scans s ON p.scan_id = s.id
    WHERE s.is_current = 1
    ORDER BY p.confidence DESC, p.rank ASC
  `).all();
}

// Get CURRENT POTD picks only
export async function getCurrentPOTDPicks() {
  const picks = await query(`
    SELECT p.*, s.potd_title, s.potd_date, s.id as scanId
    FROM picks p
    INNER JOIN scans s ON p.scan_id = s.id
    WHERE s.is_current = ?
    ORDER BY p.confidence DESC, p.rank ASC
  `, [true]);
  
  if (picks.length === 0) {
    return { picks: [], potdTitle: '', potdDate: '', scanId: null };
  }
  
  return {
    picks,
    potdTitle: picks[0].potd_title,
    potdDate: picks[0].potd_date,
    scanId: picks[0].scanid || picks[0].scanId,
  };
}

// Get HISTORY POTDs
export async function getHistoryPOTDs() {
  return await query(`
    SELECT DISTINCT s.id, s.potd_title, s.potd_date, s.scan_date, s.total_picks, s.created_at
    FROM scans s
    WHERE s.is_current = ?
    ORDER BY s.created_at DESC
    LIMIT 50
  `, [false]);
}

// Save scan
export async function saveScan(scanData) {
  const potdDate = extractPOTDDate(scanData.potdTitle);
  const scanDate = new Date().toISOString().split('T')[0];
  
  if (IS_VERCEL) {
    const existingCurrent = await queryOne(`SELECT id, potd_date FROM scans WHERE is_current = true`);
    
    if (existingCurrent && existingCurrent.potd_date !== potdDate) {
      console.log(`🆕 New POTD detected (${potdDate}) - moving old POTD to history`);
      await query(`UPDATE scans SET is_current = false WHERE is_current = true`);
    }
    
    await query(`
      INSERT INTO scans (id, potd_title, potd_url, potd_date, scan_date, total_comments, total_picks, scan_duration, status, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)
    `, [
      scanData.id,
      scanData.potdTitle,
      scanData.potdUrl,
      potdDate,
      scanDate,
      scanData.totalComments,
      scanData.totalPicks,
      scanData.scanDuration,
      scanData.status
    ]);
  } else {
    const existingCurrent = db.prepare(`SELECT id, potd_date FROM scans WHERE is_current = 1`).get();
    
    if (existingCurrent && existingCurrent.potd_date !== potdDate) {
      console.log(`🆕 New POTD detected (${potdDate}) - moving old POTD to history`);
      db.prepare(`UPDATE scans SET is_current = 0 WHERE is_current = 1`).run();
    }
    
    db.prepare(`
      INSERT INTO scans (id, potd_title, potd_url, potd_date, scan_date, total_comments, total_picks, scan_duration, status, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      scanData.id,
      scanData.potdTitle,
      scanData.potdUrl,
      potdDate,
      scanDate,
      scanData.totalComments,
      scanData.totalPicks,
      scanData.scanDuration,
      scanData.status
    );
  }
  
  console.log(`✅ Scan ${scanData.id} saved as CURRENT for ${potdDate}`);
}

// Save picks for scan - BATCH INSERT for speed
export async function savePicksForScan(scanId, picks) {
  const scanDate = new Date().toISOString().split('T')[0];
  
  console.log(`💾 Saving ${picks.length} picks to database...`);
  
  if (IS_VERCEL) {
    // Use individual inserts with retry - safer than batch
    let savedCount = 0;
    for (const pick of picks) {
      try {
        await query(`
          INSERT INTO picks (
            scan_id, scan_date, rank, confidence, sport, event, pick, odds, units,
            comment_score, comment_author, comment_body, comment_url,
            reasoning, risk_factors, ai_analysis, user_record, game_time, game_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          scanId, scanDate, pick.rank, pick.confidence, pick.sport, pick.event,
          pick.pick, pick.odds, pick.units, pick.comment_score, pick.comment_author,
          pick.comment_body, pick.comment_url, pick.reasoning, pick.risk_factors,
          pick.ai_analysis, pick.user_record, pick.game_time, pick.game_date
        ]);
        savedCount++;
      } catch (error) {
        console.error(`❌ Failed to save pick #${pick.rank}:`, error.message);
      }
    }
    console.log(`✅ Saved ${savedCount}/${picks.length} picks`);
  } else {
    // SQLite - use transaction
    const insertStmt = db.prepare(`
      INSERT INTO picks (
        scan_id, scan_date, rank, confidence, sport, event, pick, odds, units,
        comment_score, comment_author, comment_body, comment_url,
        reasoning, risk_factors, ai_analysis, user_record, game_time, game_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((picks) => {
      for (const pick of picks) {
        insertStmt.run(
          scanId, scanDate, pick.rank, pick.confidence, pick.sport, pick.event,
          pick.pick, pick.odds, pick.units, pick.comment_score, pick.comment_author,
          pick.comment_body, pick.comment_url, pick.reasoning, pick.risk_factors,
          pick.ai_analysis, pick.user_record, pick.game_time, pick.game_date
        );
      }
    });
    
    insertMany(picks);
    console.log(`✅ Saved ${picks.length} picks in transaction`);
  }
}

// Helper to escape SQL strings
function escapeSQL(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

// Update pick result
export async function updatePickResult(pickId, result, notes = null) {
  await query(
    `UPDATE picks SET result = ?, result_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [result, notes, pickId]
  );
  return true;
}

// Update user action
export async function updateUserAction(pickId, action) {
  console.log(`🎯 Updating pick ${pickId} action to: ${action}`);
  const result = await query(
    `UPDATE picks SET user_action = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [action, pickId]
  );
  console.log(`✅ Pick ${pickId} action updated to ${action}`);
  return result;
}

// Update game time
export async function updateGameTime(pickId, gameTime, gameDate) {
  await query(
    `UPDATE picks SET game_time = ?, game_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [gameTime, gameDate, pickId]
  );
}

// Get finished picks
export async function getFinishedPicks(limit = 100) {
  return await query(
    `SELECT * FROM picks WHERE result IN ('won', 'lost', 'push') ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
}

// Get my bets
export async function getMyBets() {
  console.log('📊 Fetching my bets...');
  const picks = await query(
    `SELECT * FROM picks WHERE user_action IN ('hit', 'track') ORDER BY created_at DESC`
  );
  console.log(`📊 Found ${picks.length} bets (hit/track)`);
  return picks;
}

// Get picks by date
export async function getPicksByDate(date) {
  return await query(
    `SELECT * FROM picks WHERE scan_date = ? ORDER BY confidence DESC`,
    [date]
  );
}

// Get dates with picks
export async function getDatesWithPicks() {
  return await query(
    `SELECT DISTINCT scan_date FROM picks ORDER BY scan_date DESC`
  );
}

// Get pick stats
export async function getPickStats() {
  const result = await queryOne(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
      SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
      SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as push,
      SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending
    FROM picks
  `);
  
  return {
    overall: result
  };
}

// Chat functions
export async function saveChatMessage(userMessage, aiResponse, context) {
  if (IS_VERCEL) {
    await query(
      `INSERT INTO chat_history (user_message, ai_response, context) VALUES (?, ?, ?)`,
      [userMessage, aiResponse, JSON.stringify(context)]
    );
  } else {
    db.prepare(`
      INSERT INTO chat_history (user_message, ai_response, context)
      VALUES (?, ?, ?)
    `).run(userMessage, aiResponse, JSON.stringify(context));
  }
}

export async function getChatHistory(limit = 50) {
  return await query(
    `SELECT * FROM chat_history ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

// Scheduler logs
export function logSchedulerEvent(eventType, scanId, success, message) {
  if (IS_VERCEL) return;
  
  db.prepare(`
    INSERT INTO scheduler_logs (event_type, scan_id, success, message)
    VALUES (?, ?, ?, ?)
  `).run(eventType, scanId, success ? 1 : 0, message);
}

export function getSchedulerLogs(limit = 50) {
  if (IS_VERCEL) return [];
  
  return db.prepare(`
    SELECT * FROM scheduler_logs 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(limit);
}

// Maintenance
export function optimizeDatabase() {
  if (IS_VERCEL) return;
  
  db.pragma('optimize');
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('✅ Database optimized');
}

export function removeDuplicates() {
  if (IS_VERCEL) {
    throw new Error('Use manual cleanup for Postgres');
  }
  
  db.exec(`
    DELETE FROM picks 
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM picks
      GROUP BY scan_id, pick, event
    )
  `);
  console.log('✅ Duplicates removed');
}

export async function deletePick(pickId) {
  if (IS_VERCEL) {
    await query(`DELETE FROM picks WHERE id = ?`, [pickId]);
    return true;
  } else {
    const result = db.prepare(`DELETE FROM picks WHERE id = ?`).run(pickId);
    return result.changes > 0;
  }
}

export { IS_VERCEL };
