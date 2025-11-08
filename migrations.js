import db from './database.js';

// Add Sport API fields to picks table
export function migrateAddSportAPIFields() {
  try {
    console.log('🔄 Running migration: Add Sport API fields...');
    
    // Check if columns exist first
    const tableInfo = db.prepare("PRAGMA table_info(picks)").all();
    const columnNames = tableInfo.map(col => col.name);
    
    if (!columnNames.includes('sport_event_id')) {
      db.exec(`ALTER TABLE picks ADD COLUMN sport_event_id TEXT`);
      console.log('✅ Added sport_event_id column');
    }
    
    if (!columnNames.includes('home_score')) {
      db.exec(`ALTER TABLE picks ADD COLUMN home_score INTEGER`);
      console.log('✅ Added home_score column');
    }
    
    if (!columnNames.includes('away_score')) {
      db.exec(`ALTER TABLE picks ADD COLUMN away_score INTEGER`);
      console.log('✅ Added away_score column');
    }
    
    if (!columnNames.includes('match_status')) {
      db.exec(`ALTER TABLE picks ADD COLUMN match_status TEXT`);
      console.log('✅ Added match_status column');
    }
    
    if (!columnNames.includes('last_checked_at')) {
      db.exec(`ALTER TABLE picks ADD COLUMN last_checked_at DATETIME`);
      console.log('✅ Added last_checked_at column');
    }
    
    console.log('✅ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Run migration on import
migrateAddSportAPIFields();
