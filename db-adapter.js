// Database adapter for Vercel Postgres
import { sql } from '@vercel/postgres';

// Check if we're running on Vercel
const IS_VERCEL = process.env.VERCEL === '1';

let db;

if (IS_VERCEL) {
  // Use Vercel Postgres
  console.log('🔗 Using Vercel Postgres');
  db = sql;
} else {
  // Use SQLite for local development
  console.log('🔗 Using SQLite (local)');
  const Database = require('better-sqlite3');
  db = new Database('picks.db');
  db.pragma('journal_mode = WAL');
}

export { db, IS_VERCEL };
