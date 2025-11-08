import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Cwil@gamble.2025';

// In-memory user store (replace with database in production)
let users = [];

// Security check: warn if using default credentials
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET in .env for production!');
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  WARNING: Using default admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env!');
}

// Initialize users table (create default admin)
export async function initUsersTable() {
  console.log('👥 Initializing users system...');
  
  // Create default admin user
  const adminExists = users.find(u => u.username === ADMIN_USERNAME);
  if (!adminExists) {
    users.push({
      id: 1,
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD, // In production, hash this!
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    console.log('✅ Default admin user created');
  }
  
  return { success: true };
}

// Get all users
export function getAllUsers() {
  return users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt
  }));
}

// Create new user
export function createUser(username, password, role = 'gambler') {
  if (users.find(u => u.username === username)) {
    return { success: false, error: 'Username already exists' };
  }
  
  const newUser = {
    id: users.length + 1,
    username,
    password, // In production, hash this!
    role,
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  
  return { 
    success: true, 
    user: {
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      createdAt: newUser.createdAt
    }
  };
}

// Update user role
export function updateUserRole(userId, newRole) {
  const user = users.find(u => u.id === parseInt(userId));
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  user.role = newRole;
  return { success: true, user: { id: user.id, username: user.username, role: user.role } };
}

// Delete user
export function deleteUser(userId) {
  const index = users.findIndex(u => u.id === parseInt(userId));
  if (index === -1) {
    return { success: false, error: 'User not found' };
  }
  
  // Don't allow deleting the default admin
  if (users[index].username === ADMIN_USERNAME) {
    return { success: false, error: 'Cannot delete default admin' };
  }
  
  users.splice(index, 1);
  return { success: true };
}

// Login
export function login(username, password) {
  const user = users.find(u => u.username === username && u.password === password);
  
  if (user) {
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
}

// Verify token middleware
export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  console.log('🔐 Auth check:');
  console.log('   Auth header:', authHeader ? 'Present' : 'Missing');
  console.log('   Token extracted:', token ? 'Yes' : 'No');
  
  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token valid for user:', decoded.username, 'role:', decoded.role);
    req.user = decoded;
    next();
  } catch (error) {
    console.log('❌ Token verification failed:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// Require admin middleware
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    console.log('❌ Admin access denied for user:', req.user?.username);
    return res.status(403).json({ 
      success: false, 
      error: 'Admin access required' 
    });
  }
  console.log('✅ Admin access granted for:', req.user.username);
  next();
}
