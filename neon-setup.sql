-- PickSync Database Schema for Neon Postgres
-- Run this in your Neon SQL Editor: https://console.neon.tech

-- Scans table
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  potd_title TEXT,
  potd_url TEXT,
  potd_date TEXT,
  scan_date DATE,
  total_comments INTEGER,
  total_picks INTEGER,
  scan_duration INTEGER,
  status TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_current BOOLEAN DEFAULT false
);

-- Picks table
CREATE TABLE IF NOT EXISTS picks (
  id SERIAL PRIMARY KEY,
  scan_id TEXT NOT NULL,
  scan_date DATE,
  rank INTEGER,
  confidence INTEGER,
  sport TEXT,
  event TEXT,
  pick TEXT,
  odds TEXT,
  units REAL,
  comment_score INTEGER,
  comment_author TEXT,
  comment_body TEXT,
  comment_url TEXT,
  reasoning TEXT,
  risk_factors TEXT,
  ai_analysis TEXT,
  user_record TEXT,
  result TEXT DEFAULT 'pending',
  result_notes TEXT,
  user_action TEXT DEFAULT 'none',
  game_time TEXT,
  game_date TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat history table
CREATE TABLE IF NOT EXISTS chat_history (
  id SERIAL PRIMARY KEY,
  user_message TEXT,
  ai_response TEXT,
  context TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scheduler logs table
CREATE TABLE IF NOT EXISTS scheduler_logs (
  id SERIAL PRIMARY KEY,
  event_type TEXT,
  scan_id TEXT,
  success INTEGER,
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_picks_scan_id ON picks(scan_id);
CREATE INDEX IF NOT EXISTS idx_picks_scan_date ON picks(scan_date);
CREATE INDEX IF NOT EXISTS idx_picks_result ON picks(result);
CREATE INDEX IF NOT EXISTS idx_picks_user_action ON picks(user_action);
CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date);
CREATE INDEX IF NOT EXISTS idx_scans_potd_date ON scans(potd_date);
CREATE INDEX IF NOT EXISTS idx_scans_current ON scans(is_current);

-- Insert default admin user
INSERT INTO users (username, password_hash, role)
VALUES ('admin', '$2b$10$kRh5LNaHX2sb1lGBuSFFcujkpvGOD8qOumjEFNzZy0VpuyWm8DIUq', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Done!
SELECT 'Database initialized successfully!' as status;
