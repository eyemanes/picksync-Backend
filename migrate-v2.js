import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('🔄 Running database migration (v2 - Clean Tracking)...\n');

try {
  // Add user action columns if they don't exist
  const tableInfo = db.pragma('table_info(picks)');
  const columnNames = tableInfo.map(col => col.name);
  
  if (!columnNames.includes('user_action')) {
    db.exec(`ALTER TABLE picks ADD COLUMN user_action TEXT DEFAULT 'none'`);
    console.log('✅ Added column: user_action');
  }
  
  if (!columnNames.includes('action_timestamp')) {
    db.exec(`ALTER TABLE picks ADD COLUMN action_timestamp DATETIME`);
    console.log('✅ Added column: action_timestamp');
  }
  
  // Create scan state table for incremental updates
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY,
      last_comment_id TEXT,
      last_scan_time INTEGER
    )
  `);
  console.log('✅ Created scan_state table');
  
  console.log('\n✅ Migration complete!');
  console.log('\n📊 Current schema:');
  console.log('   - user_action: hit/track/fade/none');
  console.log('   - action_timestamp: when user took action');
  console.log('   - result: won/lost/push/pending (manual)');
  console.log('   - scan_state: tracks last scanned comment');
  
  db.close();
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
