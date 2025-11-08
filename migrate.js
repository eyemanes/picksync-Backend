import Database from 'better-sqlite3';

const db = new Database('picksync.db');

console.log('🔄 Running database migration...\n');

try {
  // Check if columns already exist
  const tableInfo = db.pragma('table_info(picks)');
  const columnNames = tableInfo.map(col => col.name);
  
  const needsMatchId = !columnNames.includes('match_id');
  const needsHomeScore = !columnNames.includes('home_score');
  const needsAwayScore = !columnNames.includes('away_score');
  const needsMatchStatus = !columnNames.includes('match_status');

  if (needsMatchId || needsHomeScore || needsAwayScore || needsMatchStatus) {
    console.log('📝 Adding Sport API columns to picks table...');
    
    if (needsMatchId) {
      db.exec(`ALTER TABLE picks ADD COLUMN match_id TEXT`);
      console.log('✅ Added column: match_id');
    }
    
    if (needsHomeScore) {
      db.exec(`ALTER TABLE picks ADD COLUMN home_score INTEGER`);
      console.log('✅ Added column: home_score');
    }
    
    if (needsAwayScore) {
      db.exec(`ALTER TABLE picks ADD COLUMN away_score INTEGER`);
      console.log('✅ Added column: away_score');
    }
    
    if (needsMatchStatus) {
      db.exec(`ALTER TABLE picks ADD COLUMN match_status TEXT DEFAULT 'Not Started'`);
      console.log('✅ Added column: match_status');
    }
    
    console.log('\n✅ Migration complete! Sport API integration ready.');
  } else {
    console.log('✅ Database already up to date. No migration needed.');
  }
  
  db.close();
} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
}
