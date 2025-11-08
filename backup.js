import fs from 'fs';
import path from 'path';
import { schedule } from 'node-cron';

const DB_PATH = './picksync.db';
const BACKUP_DIR = './backups';
const IS_VERCEL = process.env.VERCEL === '1' || process.env.DATABASE_URL?.includes('postgres');

// Ensure backup directory exists (only in local dev)
if (!IS_VERCEL && !fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('📁 Created backup directory');
}

/**
 * Backup database file
 */
export function backupDatabase() {
  // Skip backups on Vercel (using Neon Postgres with automatic backups)
  if (IS_VERCEL) {
    console.log('⏭️  Skipping backup on Vercel (Neon has automatic backups)');
    return;
  }

  try {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupPath = path.join(BACKUP_DIR, `picksync-${timestamp}.db`);
    
    // Check if backup already exists today
    if (fs.existsSync(backupPath)) {
      console.log('📦 Backup already exists for today:', backupPath);
      return;
    }
    
    // Copy database file
    fs.copyFileSync(DB_PATH, backupPath);
    console.log('✅ Database backed up:', backupPath);
    
    // Clean old backups (keep last 7 days)
    cleanOldBackups();
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
  }
}

/**
 * Delete backups older than 7 days
 */
function cleanOldBackups() {
  if (IS_VERCEL) return;

  try {
    const files = fs.readdirSync(BACKUP_DIR);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    let deleted = 0;
    
    for (const file of files) {
      if (!file.startsWith('picksync-') || !file.endsWith('.db')) continue;
      
      const filePath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtimeMs;
      
      if (age > maxAge) {
        fs.unlinkSync(filePath);
        deleted++;
        console.log('🗑️  Deleted old backup:', file);
      }
    }
    
    if (deleted > 0) {
      console.log(`🧹 Cleaned ${deleted} old backup(s)`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
  }
}

/**
 * Schedule daily backups at 3 AM
 */
export function startBackupScheduler() {
  if (IS_VERCEL) {
    console.log('⏭️  Backup scheduler disabled on Vercel (Neon has automatic backups)');
    return;
  }

  // Daily backup at 3 AM
  schedule('0 3 * * *', () => {
    console.log('\n⏰ Running scheduled database backup...');
    backupDatabase();
  });
  
  console.log('📅 Database backup scheduler started (3 AM daily)');
  
  // Run backup on startup (if needed)
  backupDatabase();
}
