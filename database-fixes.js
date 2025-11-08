import Database from 'better-sqlite3';

const db = new Database('picksync.db');

/**
 * 🔧 FIX 1: Add POTD date tracking to scans table
 * This allows us to know which POTD each scan belongs to
 */
export function addPOTDDateColumn() {
  try {
    // Check if column exists
    const columns = db.pragma('table_info(scans)');
    const hasPotdDate = columns.some(col => col.name === 'potd_date');
    
    if (!hasPotdDate) {
      db.exec(`ALTER TABLE scans ADD COLUMN potd_date TEXT`);
      console.log('✅ Added potd_date column to scans table');
    } else {
      console.log('ℹ️  potd_date column already exists');
    }
  } catch (error) {
    console.error('❌ Error adding potd_date column:', error.message);
  }
}

/**
 * 🔧 FIX 2: Add is_current flag to scans table
 * Only ONE scan should have is_current = 1 (the latest POTD)
 */
export function addIsCurrentColumn() {
  try {
    const columns = db.pragma('table_info(scans)');
    const hasIsCurrent = columns.some(col => col.name === 'is_current');
    
    if (!hasIsCurrent) {
      db.exec(`ALTER TABLE scans ADD COLUMN is_current INTEGER DEFAULT 0`);
      console.log('✅ Added is_current column to scans table');
    } else {
      console.log('ℹ️  is_current column already exists');
    }
  } catch (error) {
    console.error('❌ Error adding is_current column:', error.message);
  }
}

/**
 * 🔧 FIX 3: Add unique constraint to prevent duplicate picks
 */
export function addUniqueConstraint() {
  try {
    // Create new table with unique constraint
    db.exec(`
      CREATE TABLE IF NOT EXISTS picks_new (
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        -- Unique constraint: same poster + teams + pick = duplicate
        UNIQUE(poster, teams, pick, scan_id)
      )
    `);
    
    console.log('✅ Created picks_new table with unique constraint');
  } catch (error) {
    console.error('❌ Error creating unique constraint:', error.message);
  }
}

/**
 * 🧹 FIX 4: Remove duplicate picks
 */
export function removeDuplicates() {
  try {
    const duplicates = db.prepare(`
      SELECT poster, teams, pick, scan_id, COUNT(*) as count
      FROM picks
      GROUP BY poster, teams, pick, scan_id
      HAVING COUNT(*) > 1
    `).all();
    
    console.log(`🔍 Found ${duplicates.length} duplicate groups`);
    
    if (duplicates.length > 0) {
      const transaction = db.transaction(() => {
        for (const dup of duplicates) {
          // Keep the first one, delete the rest
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
      });
      
      transaction();
      console.log('✅ Removed duplicate picks');
    } else {
      console.log('✅ No duplicates found');
    }
  } catch (error) {
    console.error('❌ Error removing duplicates:', error.message);
  }
}

/**
 * 🔄 FIX 5: Extract POTD date from title
 * Example: "Pick of the Day - 11/8/24" → "11/8/24"
 */
export function extractPOTDDate(potdTitle) {
  // Match patterns like: 11/8/24, 11/08/2024, Nov 8, etc.
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
  
  // Fallback: use current date
  return new Date().toLocaleDateString('en-US');
}

/**
 * 🔄 FIX 6: Update all existing scans with POTD dates
 */
export function backfillPOTDDates() {
  try {
    const scans = db.prepare('SELECT id, potd_title FROM scans').all();
    
    const updateStmt = db.prepare('UPDATE scans SET potd_date = ? WHERE id = ?');
    
    const transaction = db.transaction(() => {
      for (const scan of scans) {
        const potdDate = extractPOTDDate(scan.potd_title);
        updateStmt.run(potdDate, scan.id);
      }
    });
    
    transaction();
    console.log(`✅ Backfilled POTD dates for ${scans.length} scans`);
  } catch (error) {
    console.error('❌ Error backfilling POTD dates:', error.message);
  }
}

/**
 * 🔄 FIX 7: Mark the latest scan as current
 */
export function markLatestScanAsCurrent() {
  try {
    // First, unmark all scans
    db.prepare('UPDATE scans SET is_current = 0').run();
    
    // Then mark the most recent one
    db.prepare(`
      UPDATE scans 
      SET is_current = 1 
      WHERE id = (SELECT id FROM scans ORDER BY created_at DESC LIMIT 1)
    `).run();
    
    console.log('✅ Marked latest scan as current');
  } catch (error) {
    console.error('❌ Error marking current scan:', error.message);
  }
}

/**
 * 🚀 RUN ALL FIXES
 */
export function runAllFixes() {
  console.log('\n🔧 STARTING DATABASE FIXES...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  addPOTDDateColumn();
  addIsCurrentColumn();
  removeDuplicates();
  backfillPOTDDates();
  markLatestScanAsCurrent();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ALL FIXES COMPLETED!\n');
}

// Run fixes if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllFixes();
  process.exit(0);
}
