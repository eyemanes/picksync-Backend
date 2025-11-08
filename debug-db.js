import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('\n🔍 DATABASE DEBUG\n');

// Check scans
const scans = db.prepare(`
  SELECT id, potd_title, potd_date, is_current, total_picks, created_at 
  FROM scans 
  ORDER BY created_at DESC 
  LIMIT 5
`).all();

console.log('📊 SCANS:');
scans.forEach(s => {
  console.log(`  ${s.is_current ? '✅' : '  '} ${s.id} | ${s.potd_date} | ${s.total_picks} picks | ${s.created_at}`);
});

// Check current scan
const currentScan = db.prepare(`
  SELECT id, potd_title FROM scans WHERE is_current = 1
`).get();

console.log('\n📌 CURRENT SCAN:', currentScan);

// Check picks for current scan
if (currentScan) {
  const picks = db.prepare(`
    SELECT COUNT(*) as count FROM picks WHERE scan_id = ?
  `).get(currentScan.id);
  
  console.log(`📦 PICKS IN CURRENT SCAN: ${picks.count}`);
  
  const allPicksSample = db.prepare(`
    SELECT id, poster, teams, scan_id FROM picks WHERE scan_id = ? LIMIT 5
  `).all(currentScan.id);
  
  console.log('\n🎯 SAMPLE PICKS:');
  allPicksSample.forEach(p => {
    console.log(`  #${p.id} - ${p.poster} - ${p.teams}`);
  });
}

// Check total picks in database
const totalPicks = db.prepare(`SELECT COUNT(*) as count FROM picks`).get();
console.log(`\n📊 TOTAL PICKS IN DB: ${totalPicks.count}`);

db.close();
