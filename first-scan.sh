#!/bin/bash

echo "🚀 PickSync - First Scan Setup"
echo "================================"
echo ""

# Backend URL
BACKEND_URL="https://picksync-backend.vercel.app"

# Login credentials
USERNAME="admin"
PASSWORD="PicksyncAdmin2024!"

echo "1️⃣  Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")

echo "Response: $LOGIN_RESPONSE"
echo ""

# Extract token (using jq if available, otherwise manual)
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed! Check your credentials."
  exit 1
fi

echo "✅ Login successful!"
echo "Token: ${TOKEN:0:20}..."
echo ""

echo "2️⃣  Triggering first scan..."
SCAN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/scan" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN")

echo "Response: $SCAN_RESPONSE"
echo ""

echo "3️⃣  Monitoring scan status..."
echo "Check status at: $BACKEND_URL/api/scan/status"
echo ""

# Poll status 10 times
for i in {1..10}; do
  echo "Checking status (attempt $i/10)..."
  STATUS=$(curl -s "$BACKEND_URL/api/scan/status")
  echo "$STATUS"
  echo ""
  
  # Check if scan is complete
  if echo "$STATUS" | grep -q '"scanning":false'; then
    echo "✅ Scan complete!"
    break
  fi
  
  sleep 5
done

echo ""
echo "🎉 Done! Check your frontend at https://picksync-frontend-k8an.vercel.app"
