import Database from 'better-sqlite3';

const db = new Database('picksync.db');

const newHash = '$2b$10$kRh5LNaHX2sb1lGBuSFFcujkpvGOD8qOumjEFNzZy0VpuyWm8DIUq';

console.log('🔄 Updating admin password hash...');

const result = db.prepare(`
  UPDATE users 
  SET password_hash = ?
  WHERE username = 'admin'
`).run(newHash);

console.log(`✅ Updated ${result.changes} user(s)`);

const admin = db.prepare('SELECT username, role, created_at FROM users WHERE username = ?').get('admin');
console.log('👤 Admin user:', admin);

db.close();
console.log('✨ Done!');
