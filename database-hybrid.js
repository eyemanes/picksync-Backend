// Database wrapper - works with SQLite (local) and Postgres (Vercel)
import Database from 'better-sqlite3';
import { sql } from '@vercel/postgres';

const IS_VERCEL = process.env.VERCEL === '1' || process.env.DATABASE_URL?.includes('postgres');

let db;

if (IS_VERCEL) {
  console.log('🔗 Using Vercel Postgres (Production)');
  db = sql;
} else {
  console.log('🔗 Using SQLite (Local Development)');
  db = new Database('picksync.db');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 10000');
  db.pragma('temp_store = MEMORY');
}

// Helper to run queries that work on both databases
async function query(sqlQuery, params = []) {
  if (IS_VERCEL) {
    // Postgres
    if (params.length === 0) {
      return await sql.query(sqlQuery);
    }
    
    // Convert ? placeholders to $1, $2, etc for Postgres
    let paramIndex = 1;
    const pgQuery = sqlQuery.replace(/\?/g, () => `$${paramIndex++}`);
    return await sql.query(pgQuery, params);
  } else {
    // SQLite
    if (sqlQuery.toLowerCase().includes('select')) {
      return db.prepare(sqlQuery).all(...params);
    } else {
      return db.prepare(sqlQuery).run(...params);
    }
  }
}

// Helper to get a single row
async function queryOne(sqlQuery, params = []) {
  if (IS_VERCEL) {
    const result = await query(sqlQuery, params);
    return result.rows[0];
  } else {
    return db.prepare(sqlQuery).get(...params);
  }
}

// Helper to run without returning data
async function exec(sqlQuery) {
  if (IS_VERCEL) {
    await sql.query(sqlQuery);
  } else {
    db.exec(sqlQuery);
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

// Initialize database (auto-runs on import)
export async function initDatabase() {
  try {
    if (IS_VERCEL) {
      console.log('✅ Database initialized (Vercel Postgres)');
      // Tables should already exist from vercel-postgres-schema.sql
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
  const scans = await query(
    `SELECT id, potd_title, scan_date, potd_date, total_picks, status, created_at, is_current
     FROM scans 
     ORDER BY created_at DESC 
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return IS_VERCEL ? scans.rows : scans;
}

// Get picks by scan ID
export async function getPicksByScanId(scanId) {
  const picks = await query(
    `SELECT * FROM picks WHERE scan_id = ? ORDER BY confidence DESC, rank ASC`,
    [scanId]
  );
  return IS_VERCEL ? picks.rows : picks;
}

// Get today's picks (all picks from most recent scan)
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
  const query = `
    SELECT p.*, s.potd_title, s.potd_date, s.id as scanId
    FROM picks p
    INNER JOIN scans s ON p.scan_id = s.id
    WHERE s.is_current = ${IS_VERCEL ? 'true' : '1'}
    ORDER BY p.confidence DESC, p.rank ASC
  `;
  
  if (IS_VERCEL) {
    const result = await sql.query(query);
    const picks = result.rows;
    
    if (picks.length === 0) {
      return { picks: [], potdTitle: '', potdDate: '', scanId: null };
    }
    
    return {
      picks,
      potdTitle: picks[0].potd_title,
      potdDate: picks[0].potd_date,
      scanId: picks[0].scanid,
    };
  } else {
    const picks = db.prepare(query).all();
    
    if (picks.length === 0) {
      return { picks: [], potdTitle: '', potdDate: '', scanId: null };
    }
    
    return {
      picks,
      potdTitle: picks[0].potd_title,
      potdDate: picks[0].potd_date,
      scanId: picks[0].scanId,
    };
  }
}

// Get HISTORY POTDs (old POTDs, not current)
export async function getHistoryPOTDs() {
  const query = `
    SELECT DISTINCT s.id, s.potd_title, s.potd_date, s.scan_date, s.total_picks, s.created_at
    FROM scans s
    WHERE s.is_current = ${IS_VERCEL ? 'false' : '0'}
    ORDER BY s.created_at DESC
    LIMIT 50
  `;
  
  if (IS_VERCEL) {
    const result = await sql.query(query);
    return result.rows;
  } else {
    return db.prepare(query).all();
  }
}

// Save scan
export function saveScan(scanData) {
  if (IS_VERCEL) {
    throw new Error('Use savePicksForScan() for Vercel (async)');
  }
  
  const potdDate = extractPOTDDate(scanData.potdTitle);
  
  // Check if we already have a CURRENT POTD for today
  const existingCurrent = db.prepare(`
    SELECT id, potd_date FROM scans WHERE is_current = 1
  `).get();
  
  if (existingCurrent && existingCurrent.potd_date !== potdDate) {
    console.log(`🆕 New POTD detected (${potdDate}) - moving old POTD to history`);
    db.prepare(`UPDATE scans SET is_current = 0 WHERE is_current = 1`).run();
  }
  
  const scanDate = new Date().toISOString().split('T')[0];
  
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
  
  console.log(`✅ Scan ${scanData.id} saved as CURRENT for ${potdDate}`);
}

// Save picks for scan
export async function savePicksForScan(scanId, picks) {
  if (IS_VERCEL) {
    // Postgres version
    const scanInfo = await sql.query(`SELECT potd_title, potd_date FROM scans WHERE id = $1`, [scanId]);
    const potdTitle = scanInfo.rows[0]?.potd_title || '';
    const potdDate = extractPOTDDate(potdTitle);
    const scanDate = new Date().toISOString().split('T')[0];
    
    // Check for existing current POTD
    const existingCurrent = await sql.query(`SELECT id, potd_date FROM scans WHERE is_current = true`);
    
    if (existingCurrent.rows.length > 0 && existingCurrent.rows[0].potd_date !== potdDate) {
      console.log(`🆕 New POTD detected (${potdDate}) - moving old POTD to history`);
      await sql.query(`UPDATE scans SET is_current = false WHERE is_current = true`);
    }
    
    // Insert picks
    let savedCount = 0;
    let duplicateCount = 0;
    
    for (const pick of picks) {
      try {
        await sql.query(`
          INSERT INTO picks (
            scan_id, scan_date, rank, confidence, sport, event, pick, odds, units,
            comment_score, comment_author, comment_body, comment_url,
            reasoning, risk_factors, ai_analysis, user_record
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
          scanId, scanDate, pick.rank, pick.confidence, pick.sport, pick.event,
          pick.pick, pick.odds, pick.units, pick.comment_score, pick.comment_author,
          pick.comment_body, pick.comment_url, pick.reasoning, pick.risk_factors,
          pick.ai_analysis, pick.user_record
        ]);
        savedCount++;
      } catch (error) {
        if (error.message.includes('duplicate')) {
          duplicateCount++;
        } else {
          throw error;
        }
      }
    }
    
    console.log(`✅ Saved ${savedCount} picks (${duplicateCount} duplicates skipped)`);
    return;
  }
  
  // SQLite version
  const scanInfo = db.prepare(`SELECT potd_title FROM scans WHERE id = ?`).get(scanId);
  const potdDate = extractPOTDDate(scanInfo?.potd_title || '');
  const scanDate = new Date().toISOString().split('T')[0];
  
  const insertStmt = db.prepare(`
    INSERT INTO picks (
      scan_id, scan_date, rank, confidence, sport, event, pick, odds, units,
      comment_score, comment_author, comment_body, comment_url,
      reasoning, risk_factors, ai_analysis, user_record
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let savedCount = 0;
  let duplicateCount = 0;
  
  const insertMany = db.transaction((picks) => {
    for (const pick of picks) {
      try {
        insertStmt.run(
          scanId, scanDate, pick.rank, pick.confidence, pick.sport, pick.event,
          pick.pick, pick.odds, pick.units, pick.comment_score, pick.comment_author,
          pick.comment_body, pick.comment_url, pick.reasoning, pick.risk_factors,
          pick.ai_analysis, pick.user_record
        );
        savedCount++;
      } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
          duplicateCount++;
        } else {
          throw error;
        }
      }
    }
  });
  
  insertMany(picks);
  console.log(`✅ Saved ${savedCount} picks (${duplicateCount} duplicates skipped)`);
}

// Update pick result
export async function updatePickResult(pickId, result, notes = null) {
  const query = `UPDATE picks SET result = ?, result_notes = ?, updated_at = ${IS_VERCEL ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP'} WHERE id = ?`;
  
  if (IS_VERCEL) {
    await sql.query(query.replace(/\?/g, (_, i) => `$${i + 1}`), [result, notes, pickId]);
    return true;
  } else {
    const result = db.prepare(query).run(result, notes, pickId);
    return result.changes > 0;
  }
}

// Update user action
export async function updateUserAction(pickId, action) {
  const query = `UPDATE picks SET user_action = ?, updated_at = ${IS_VERCEL ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP'} WHERE id = ?`;
  
  if (IS_VERCEL) {
    await sql.query(query.replace(/\?/g, (_, i) => `$${i + 1}`), [action, pickId]);
  } else {
    db.prepare(query).run(action, pickId);
  }
}

// Get finished picks
export async function getFinishedPicks(limit = 100) {
  const query = `
    SELECT * FROM picks 
    WHERE result IN ('won', 'lost', 'push')
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  
  if (IS_VERCEL) {
    const result = await sql.query(query.replace('?', '$1'), [limit]);
    return result.rows;
  } else {
    return db.prepare(query).all(limit);
  }
}

// Get my bets (HIT + TRACK)
export async function getMyBets() {
  const query = `
    SELECT * FROM picks 
    WHERE user_action IN ('hit', 'track')
    ORDER BY created_at DESC
  `;
  
  if (IS_VERCEL) {
    const result = await sql.query(query);
    return result.rows;
  } else {
    return db.prepare(query).all();
  }
}

// Get picks stats
export async function getPickStats() {
  if (IS_VERCEL) {
    const result = await sql.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
        SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as push,
        SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending
      FROM picks
    `);
    return result.rows[0];
  } else {
    return db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost,
        SUM(CASE WHEN result = 'push' THEN 1 ELSE 0 END) as push,
        SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending
      FROM picks
    `).get();
  }
}

// Chat functions
export function saveChatMessage(userMessage, aiResponse, context) {
  if (IS_VERCEL) {
    throw new Error('Chat not yet supported on Vercel');
  }
  
  db.prepare(`
    INSERT INTO chat_history (user_message, ai_response, context)
    VALUES (?, ?, ?)
  `).run(userMessage, aiResponse, JSON.stringify(context));
}

export function getChatHistory(limit = 50) {
  if (IS_VERCEL) {
    throw new Error('Chat not yet supported on Vercel');
  }
  
  return db.prepare(`
    SELECT * FROM chat_history 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(limit);
}

// Scheduler logs
export function logSchedulerEvent(eventType, scanId, success, message) {
  if (IS_VERCEL) return; // Skip logs on Vercel
  
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
    throw new Error('Use Postgres DISTINCT or manual cleanup');
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

export function deletePick(pickId) {
  if (IS_VERCEL) {
    throw new Error('Use async version');
  }
  
  const result = db.prepare(`DELETE FROM picks WHERE id = ?`).run(pickId);
  return result.changes > 0;
}

// Additional functions from original database.js...
export function updateGameTime(pickId, gameTime, gameDate) {
  if (IS_VERCEL) {
    throw new Error('Use async version');
  }
  
  db.prepare(`
    UPDATE picks 
    SET game_time = ?, game_date = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(gameTime, gameDate, pickId);
}

export function getPicksByDate(date) {
  if (IS_VERCEL) {
    throw new Error('Use async version');
  }
  
  return db.prepare(`
    SELECT * FROM picks 
    WHERE scan_date = ?
    ORDER BY confidence DESC
  `).all(date);
}

export function getDatesWithPicks() {
  if (IS_VERCEL) {
    throw new Error('Use async version');
  }
  
  return db.prepare(`
    SELECT DISTINCT scan_date 
    FROM picks 
    ORDER BY scan_date DESC
  `).all();
}

export { db, IS_VERCEL };
