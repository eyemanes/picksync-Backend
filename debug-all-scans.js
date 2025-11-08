import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('\n🔍 ALL SCANS FOR 11/7/25:\n');

const scans = db.prepare(`
  SELECT id, potd_date, is_current, total_picks, created_at 
  FROM scans 
  WHERE potd_date = '11/7/25'
  ORDER BY created_at DESC
`).all();

scans.forEach(s => {
  console.log(`${s.is_current ? '✅ CURRENT' : '⚪ OLD    '} | ${s.id} | ${s.total_picks} picks | ${s.created_at}`);
  
  const pickCount = db.prepare(`SELECT COUNT(*) as count FROM picks WHERE scan_id = ?`).get(s.id);
  console.log(`   → Actually has ${pickCount.count} picks in database\n`);
});

db.close();
