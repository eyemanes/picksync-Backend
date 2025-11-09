import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('\n🔧 FIXING DATABASE ISSUES...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ISSUE 1: Fix getHistoryPOTDs - Check current scans
console.log('📊 Issue 1: Checking scan is_current values...');
const allScans = db.prepare(`SELECT id, potd_title, potd_date, is_current, created_at FROM scans ORDER BY created_at DESC`).all();
console.log(`   Total scans: ${allScans.length}`);
console.log(`   Current scans (is_current=1): ${allScans.filter(s => s.is_current === 1).length}`);
console.log(`   History scans (is_current=0): ${allScans.filter(s => s.is_current === 0).length}`);

// Show the most recent scans
console.log('\n   Recent scans:');
allScans.slice(0, 5).forEach(scan => {
  console.log(`   - ${scan.potd_date || 'No date'} | is_current=${scan.is_current} | ${scan.potd_title?.substring(0, 50)}...`);
});

// Fix: Ensure only the LATEST scan is current
console.log('\n🔧 Fixing: Setting only latest scan as current...');
db.prepare(`UPDATE scans SET is_current = 0`).run();
db.prepare(`
  UPDATE scans 
  SET is_current = 1 
  WHERE id = (SELECT id FROM scans ORDER BY created_at DESC LIMIT 1)
`).run();

const currentScan = db.prepare(`SELECT id, potd_title, potd_date FROM scans WHERE is_current = 1`).get();
console.log(`✅ Current scan: ${currentScan.potd_date} - ${currentScan.potd_title?.substring(0, 50)}...`);

const historyCount = db.prepare(`SELECT COUNT(*) as count FROM scans WHERE is_current = 0`).get().count;
console.log(`✅ History scans: ${historyCount}`);

// ISSUE 2: Check user_action column
console.log('\n📊 Issue 2: Checking user_action values...');
const actionCounts = db.prepare(`
  SELECT user_action, COUNT(*) as count 
  FROM picks 
  GROUP BY user_action
`).all();

console.log('   User action distribution:');
actionCounts.forEach(row => {
  console.log(`   - ${row.user_action}: ${row.count}`);
});

// Check if there are any picks with hit/track action
const myBetsCount = db.prepare(`
  SELECT COUNT(*) as count 
  FROM picks 
  WHERE user_action IN ('hit', 'track')
`).get().count;

console.log(`\n   Picks with HIT or TRACK: ${myBetsCount}`);

if (myBetsCount === 0) {
  console.log('   ⚠️  No picks have been hit or tracked yet!');
  console.log('   💡 Try clicking HIT or TRACK on a pick to test');
} else {
  console.log('   ✅ User actions are being saved');
  
  // Show sample
  const samples = db.prepare(`
    SELECT id, pick, user_action, updated_at 
    FROM picks 
    WHERE user_action IN ('hit', 'track')
    LIMIT 3
  `).all();
  
  console.log('\n   Sample tracked picks:');
  samples.forEach(p => {
    console.log(`   - Pick #${p.id}: ${p.pick.substring(0, 30)}... | Action: ${p.user_action} | Updated: ${p.updated_at}`);
  });
}

// ISSUE 3: Verify picks are being saved to current scan
console.log('\n📊 Issue 3: Verifying picks in current scan...');
const currentPicksCount = db.prepare(`
  SELECT COUNT(*) as count
  FROM picks p
  INNER JOIN scans s ON p.scan_id = s.id
  WHERE s.is_current = 1
`).get().count;

console.log(`   Picks in current POTD: ${currentPicksCount}`);

if (currentPicksCount === 0) {
  console.log('   ⚠️  No picks in current scan! Try running a scan.');
} else {
  console.log('   ✅ Current POTD has picks');
}

// Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ DATABASE FIXES COMPLETED!');
console.log('\n📋 Summary:');
console.log(`   - Current POTD: ${currentScan.potd_date}`);
console.log(`   - History POTDs: ${historyCount}`);
console.log(`   - Tracked bets: ${myBetsCount}`);
console.log(`   - Picks in current POTD: ${currentPicksCount}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

db.close();
