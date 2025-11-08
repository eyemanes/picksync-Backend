import Database from 'better-sqlite3';

const db = new Database('picksync.db');

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

console.log('\n🔧 STARTING DATABASE MIGRATION...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Add potd_date column
try {
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

// Add is_current column
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

// Remove duplicates
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

// Backfill POTD dates
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

// Mark latest scan as current
try {
  db.prepare('UPDATE scans SET is_current = 0').run();
  db.prepare(`
    UPDATE scans 
    SET is_current = 1 
    WHERE id = (SELECT id FROM scans ORDER BY created_at DESC LIMIT 1)
  `).run();
  
  console.log('✅ Marked latest scan as current');
} catch (error) {
  console.error('❌ Error marking current scan:', error.message);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ MIGRATION COMPLETED!\n');

db.close();
