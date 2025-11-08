import express from 'express';
import { requireAdmin } from '../auth.js';

const router = express.Router();

// All routes here already have verifyToken applied from server.js
// We just need to add requireAdmin

// PATCH /api/admin/picks/:id - Edit pick info (game time, teams, notes)
router.patch('/picks/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { game_time, game_date, teams, notes } = req.body;
  
  console.log(`🔧 Admin ${req.user.username} editing pick ${id}`);
  
  try {
    const db = req.db;
    
    // Check if pick exists
    const pick = await db.get('SELECT * FROM picks WHERE id = ?', [id]);
    if (!pick) {
      return res.status(404).json({ 
        success: false, 
        error: 'Pick not found' 
      });
    }
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    
    if (game_time !== undefined) {
      updates.push('game_time = ?');
      values.push(game_time);
    }
    if (game_date !== undefined) {
      updates.push('game_date = ?');
      values.push(game_date);
    }
    if (teams !== undefined) {
      updates.push('teams = ?');
      values.push(teams);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      values.push(notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }
    
    values.push(id);
    
    // Update pick
    await db.run(
      `UPDATE picks SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    console.log(`✅ Pick ${id} updated:`, { game_time, game_date, teams, notes });
    
    res.json({ 
      success: true,
      message: 'Pick updated successfully',
      updates: { game_time, game_date, teams, notes }
    });
  } catch (err) {
    console.error('❌ Edit pick error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update pick. Please try again.' 
    });
  }
});

// DELETE /api/admin/picks/:id - Delete pick
router.delete('/picks/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Admin ${req.user.username} deleting pick ${id}`);
  
  try {
    const db = req.db;
    
    // Check if pick exists
    const pick = await db.get('SELECT * FROM picks WHERE id = ?', [id]);
    if (!pick) {
      return res.status(404).json({ 
        success: false, 
        error: 'Pick not found' 
      });
    }
    
    // Delete the pick
    await db.run('DELETE FROM picks WHERE id = ?', [id]);
    
    // Also delete related user actions
    await db.run('DELETE FROM user_actions WHERE pick_id = ?', [id]);
    
    console.log(`✅ Pick ${id} deleted: ${pick.pick}`);
    
    res.json({ 
      success: true,
      message: 'Pick deleted successfully',
      deletedPick: pick
    });
  } catch (err) {
    console.error('❌ Delete pick error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete pick. Please try again.' 
    });
  }
});

// GET /api/admin/stats - Get admin statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const db = req.db;
    
    const totalPicks = await db.get('SELECT COUNT(*) as count FROM picks');
    const totalScans = await db.get('SELECT COUNT(*) as count FROM scans');
    const recentPicks = await db.all(
      'SELECT * FROM picks ORDER BY created_at DESC LIMIT 10'
    );
    
    res.json({ 
      success: true,
      stats: {
        totalPicks: totalPicks.count,
        totalScans: totalScans.count,
        recentPicks
      }
    });
  } catch (err) {
    console.error('❌ Admin stats error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch admin stats' 
    });
  }
});

export default router;
