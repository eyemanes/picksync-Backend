import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query, queryOne, IS_VERCEL } from './database.js';
import Database from 'better-sqlite3';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// For SQLite only
let db;
if (!IS_VERCEL) {
  db = new Database('picksync.db');
}

// Security check: warn if using default credentials
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET in .env for production!');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
  console.warn('⚠️  WARNING: Admin credentials not set. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in .env!');
}

// Initialize users table (create default admin)
export async function initUsersTable() {
  console.log('👥 Initializing users system...');
  
  try {
    if (IS_VERCEL) {
      // Postgres - create table if not exists
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'gambler',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Check if admin exists
      const adminExists = await queryOne(`SELECT id FROM users WHERE username = ?`, [ADMIN_USERNAME]);
      
      if (!adminExists) {
        await query(`
          INSERT INTO users (username, password_hash, role)
          VALUES (?, ?, 'admin')
        `, [ADMIN_USERNAME, ADMIN_PASSWORD_HASH]);
        console.log('✅ Default admin user created in database');
      }
    } else {
      // SQLite - create table if not exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'gambler',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Check if admin exists
      const adminExists = db.prepare(`SELECT id FROM users WHERE username = ?`).get(ADMIN_USERNAME);
      
      if (!adminExists) {
        db.prepare(`
          INSERT INTO users (username, password_hash, role)
          VALUES (?, ?, 'admin')
        `).run(ADMIN_USERNAME, ADMIN_PASSWORD_HASH);
        console.log('✅ Default admin user created in database');
      }
    }
    
    console.log('✅ Users table initialized');
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to initialize users table:', error);
    throw error;
  }
}

// Get all users
export async function getAllUsers() {
  try {
    const users = await query(`
      SELECT id, username, role, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    return users;
  } catch (error) {
    console.error('❌ Failed to get users:', error);
    return [];
  }
}

// Create new user
export async function createUser(username, password, role = 'gambler') {
  try {
    // Check if username exists
    const existing = await queryOne(`SELECT id FROM users WHERE username = ?`, [username]);
    if (existing) {
      throw new Error('Username already exists');
    }
    
    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Insert user
    if (IS_VERCEL) {
      const result = await query(`
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, ?)
        RETURNING id, username, role, created_at
      `, [username, passwordHash, role]);
      
      console.log('✅ User created:', username);
      return result[0];
    } else {
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, ?)
      `).run(username, passwordHash, role);
      
      const newUser = db.prepare(`SELECT id, username, role, created_at FROM users WHERE id = ?`).get(result.lastInsertRowid);
      console.log('✅ User created:', username);
      return newUser;
    }
  } catch (error) {
    console.error('❌ Failed to create user:', error);
    throw error;
  }
}

// Update user role
export async function updateUserRole(userId, newRole) {
  try {
    await query(`
      UPDATE users 
      SET role = ?
      WHERE id = ?
    `, [newRole, userId]);
    
    console.log(`✅ User ${userId} role updated to ${newRole}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update user role:', error);
    throw error;
  }
}

// Delete user
export async function deleteUser(userId) {
  try {
    // Check if it's the default admin
    const user = await queryOne(`SELECT username FROM users WHERE id = ?`, [userId]);
    if (user && user.username === ADMIN_USERNAME) {
      throw new Error('Cannot delete default admin');
    }
    
    await query(`DELETE FROM users WHERE id = ?`, [userId]);
    console.log(`✅ User ${userId} deleted`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete user:', error);
    throw error;
  }
}

// Login
export async function login(username, password) {
  try {
    const user = await queryOne(`
      SELECT id, username, password_hash, role
      FROM users
      WHERE username = ?
    `, [username]);
    
    if (!user) {
      return { success: false, message: 'Invalid credentials' };
    }
    
    // Compare password with bcrypt
    const isValid = await bcrypt.compare(password, user.password_hash || user.password_hash);
    
    if (isValid) {
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return { 
        success: true, 
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      };
    }
    
    return { success: false, message: 'Invalid credentials' };
  } catch (error) {
    console.error('❌ Login error:', error);
    return { success: false, message: 'Login failed' };
  }
}

// Verify token middleware
export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// Require admin middleware
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      error: 'Admin access required' 
    });
  }
  next();
}
