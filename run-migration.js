import Database from 'better-sqlite3';

console.log('\n🔧 PICKSYNC POTD MIGRATION');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const db = new Database('picksync.db');

// Helper function to extract POTD date from title
function extractPOTDDate(potdTitle) {
  if (!potdTitle) return new Date().toLocaleDateString('en-US');
  
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

// Step 1: Check current schema
console.log('📊 Step 1: Checking current database schema...');
const columns = db.pragma('table_info(scans)');
console.log('Current scans table columns:', columns.map(c => c.name).join(', '));

// Step 2: Add potd_date column if missing
console.log('\n📊 Step 2: Adding potd_date column...');
try {
  const hasPotdDate = columns.some(col => col.name === 'potd_date');
  
  if (!hasPotdDate) {
    db.exec(`ALTER TABLE scans ADD COLUMN potd_date TEXT`);
    console.log('✅ Added potd_date column');
  } else {
    console.log('ℹ️  potd_date column already exists');
  }
} catch (error) {
  console.error('❌ Error adding potd_date:', error.message);
  process.exit(1);
}

// Step 3: Add is_current column if missing
console.log('\n📊 Step 3: Adding is_current column...');
try {
  const columnsRefresh = db.pragma('table_info(scans)');
  const hasIsCurrent = columnsRefresh.some(col => col.name === 'is_current');
  
  if (!hasIsCurrent) {
    db.exec(`ALTER TABLE scans ADD COLUMN is_current INTEGER DEFAULT 0`);
    console.log('✅ Added is_current column');
  } else {
    console.log('ℹ️  is_current column already exists');
  }
} catch (error) {
  console.error('❌ Error adding is_current:', error.message);
  process.exit(1);
}

// Step 4: Remove duplicates
console.log('\n📊 Step 4: Removing duplicate picks...');
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
      let totalDeleted = 0;
      for (const dup of duplicates) {
        const result = db.prepare(`
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
        totalDeleted += result.changes;
      }
      return totalDeleted;
    });
    
    const deleted = transaction();
    console.log(`✅ Removed ${deleted} duplicate picks`);
  } else {
    console.log('✅ No duplicates found');
  }
} catch (error) {
  console.error('❌ Error removing duplicates:', error.message);
}

// Step 5: Backfill POTD dates
console.log('\n📊 Step 5: Extracting POTD dates from titles...');
try {
  const scans = db.prepare('SELECT id, potd_title FROM scans').all();
  console.log(`📋 Found ${scans.length} scans to process`);
  
  if (scans.length > 0) {
    const updateStmt = db.prepare('UPDATE scans SET potd_date = ? WHERE id = ?');
    
    const transaction = db.transaction(() => {
      for (const scan of scans) {
        const potdDate = extractPOTDDate(scan.potd_title);
        updateStmt.run(potdDate, scan.id);
        console.log(`  ✓ ${scan.id}: "${scan.potd_title}" → ${potdDate}`);
      }
    });
    
    transaction();
    console.log(`✅ Backfilled POTD dates for ${scans.length} scans`);
  }
} catch (error) {
  console.error('❌ Error backfilling dates:', error.message);
  process.exit(1);
}

// Step 6: Mark latest scan as current
console.log('\n📊 Step 6: Marking latest scan as current...');
try {
  // First, unmark all
  db.prepare('UPDATE scans SET is_current = 0').run();
  
  // Get the latest scan
  const latestScan = db.prepare(`
    SELECT id, potd_title, potd_date 
    FROM scans 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get();
  
  if (latestScan) {
    db.prepare('UPDATE scans SET is_current = 1 WHERE id = ?').run(latestScan.id);
    console.log(`✅ Marked as current: ${latestScan.potd_title} (${latestScan.potd_date})`);
  } else {
    console.log('⚠️  No scans found to mark as current');
  }
} catch (error) {
  console.error('❌ Error marking current scan:', error.message);
  process.exit(1);
}

// Step 7: Verify migration
console.log('\n📊 Step 7: Verifying migration...');
try {
  const verifyColumns = db.pragma('table_info(scans)');
  const hasPotdDate = verifyColumns.some(col => col.name === 'potd_date');
  const hasIsCurrent = verifyColumns.some(col => col.name === 'is_current');
  
  console.log('✓ potd_date column:', hasPotdDate ? '✅ EXISTS' : '❌ MISSING');
  console.log('✓ is_current column:', hasIsCurrent ? '✅ EXISTS' : '❌ MISSING');
  
  const currentScan = db.prepare('SELECT COUNT(*) as count FROM scans WHERE is_current = 1').get();
  console.log(`✓ Current POTDs: ${currentScan.count} (should be 1)`);
  
  const totalScans = db.prepare('SELECT COUNT(*) as count FROM scans').get();
  const historyScans = db.prepare('SELECT COUNT(*) as count FROM scans WHERE is_current = 0').get();
  console.log(`✓ Total scans: ${totalScans.count} (${historyScans.count} in history)`);
  
  const totalPicks = db.prepare('SELECT COUNT(*) as count FROM picks').get();
  console.log(`✓ Total picks: ${totalPicks.count}`);
  
  if (hasPotdDate && hasIsCurrent && currentScan.count === 1) {
    console.log('\n✅ Migration completed successfully!');
  } else {
    console.log('\n⚠️  Migration completed with warnings');
  }
} catch (error) {
  console.error('❌ Error verifying:', error.message);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎉 DONE! Restart your backend server now.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

db.close();
