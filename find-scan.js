import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('\n🔍 LOOKING FOR RECENT SCANS:\n');

const recentScans = db.prepare(`
  SELECT id, potd_date, is_current, total_picks, created_at 
  FROM scans 
  ORDER BY created_at DESC
  LIMIT 10
`).all();

recentScans.forEach(s => {
  const pickCount = db.prepare(`SELECT COUNT(*) as count FROM picks WHERE scan_id = ?`).get(s.id);
  console.log(`${s.is_current ? '✅' : '⚪'} ${s.id} | ${s.potd_date} | Saved: ${s.total_picks} | Actual: ${pickCount.count}`);
});

console.log('\n🔍 SEARCHING FOR scan_1762526120727:\n');

const specificScan = db.prepare(`SELECT * FROM scans WHERE id LIKE '%526120%'`).all();
console.log('Found:', specificScan.length === 0 ? 'NONE!' : specificScan);

if (specificScan.length > 0) {
  const picks = db.prepare(`SELECT COUNT(*) as count FROM picks WHERE scan_id = ?`).get(specificScan[0].id);
  console.log(`Picks in that scan: ${picks.count}`);
}

db.close();
