import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('\n🧹 CLEANING UP OLD 11/7/25 SCANS\n');

// Get all 11/7 scans
const oldScans = db.prepare(`
  SELECT id, is_current, total_picks FROM scans WHERE potd_date = '11/7/25'
`).all();

console.log(`Found ${oldScans.length} scans for 11/7/25:`);
oldScans.forEach(s => {
  console.log(`  ${s.is_current ? '✅ CURRENT' : '⚪ OLD    '} ${s.id} (${s.total_picks} picks)`);
});

// Delete old ones (keep current)
const toDelete = oldScans.filter(s => s.is_current === 0);

console.log(`\n🗑️  Deleting ${toDelete.length} old scans...`);

for (const scan of toDelete) {
  // Delete picks first
  const deleted = db.prepare('DELETE FROM picks WHERE scan_id = ?').run(scan.id);
  console.log(`  ✓ Deleted ${deleted.changes} picks for ${scan.id}`);
  
  // Delete scan
  db.prepare('DELETE FROM scans WHERE id = ?').run(scan.id);
  console.log(`  ✓ Deleted scan ${scan.id}`);
}

console.log('\n✅ Cleanup complete!\n');

// Show what's left
const remaining = db.prepare(`
  SELECT id, potd_date, is_current, total_picks FROM scans ORDER BY created_at DESC LIMIT 5
`).all();

console.log('📊 Remaining scans:');
remaining.forEach(s => {
  console.log(`  ${s.is_current ? '✅' : '⚪'} ${s.id} | ${s.potd_date} | ${s.total_picks} picks`);
});

db.close();
