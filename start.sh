#!/bin/bash
# PICKSYNC POTD FIX - EASY SETUP

echo "🔧 PICKSYNC POTD MIGRATION & STARTUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Change to backend directory
cd "$(dirname "$0")"

# Check if database exists
if [ ! -f "picksync.db" ]; then
    echo "❌ ERROR: picksync.db not found!"
    echo "   Make sure you're in the PicksyncBackend directory"
    exit 1
fi

echo "📊 Step 1: Backing up database..."
cp picksync.db picksync.db.backup-$(date +%Y%m%d-%H%M%S)
echo "✅ Backup created"
echo ""

echo "📊 Step 2: Running migration..."
node run-migration.js

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed!"
    echo ""
    echo "📊 Step 3: Starting server..."
    echo ""
    npm start
else
    echo ""
    echo "❌ Migration failed!"
    echo "   Check the errors above"
    exit 1
fi
