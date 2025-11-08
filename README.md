# Picksync Backend v2.0 🚀

**Automated sports betting picks analyzer** that fetches Reddit comments, analyzes with Grok AI, and serves structured betting picks through a REST API.

## 🆕 What's New in v2.0

### Core Improvements
- ✅ **Automated Scheduling** - Runs scans automatically at set times (9 AM, 3 PM, 9 PM by default)
- ✅ **Complete Comment Fetching** - Gets ALL comments from POTD threads with pagination
- ✅ **Structured AI Analysis** - Grok returns JSON with all required fields
- ✅ **Advanced Caching** - Node-cache for faster responses and reduced API calls
- ✅ **Better Data Model** - Comprehensive database schema with more fields
- ✅ **Performance Optimizations** - Compression, WAL mode, batch inserts

### New Features
- 📊 **Rich Pick Data**: Confidence, sport, teams, game time, pick details, poster history
- 🤖 **Enhanced AI Analysis**: Grok provides reasoning and key factors for each pick
- ⏰ **Flexible Scheduling**: Configure scan times via environment variables
- 📦 **Smart Caching**: Reduces load and speeds up common queries
- 📈 **Comprehensive Stats**: Win rates by sport, top posters, performance tracking
- 🔍 **Scheduler Logs**: Track automated scan history and performance

---

## 📋 Prerequisites

- Node.js 18+ 
- RapidAPI account (for Reddit API)
- OpenRouter account (for Grok AI)

---

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
# API Keys
RAPIDAPI_KEY=your_rapidapi_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Authentication
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret

# Server
PORT=3002
NODE_ENV=development

# Scheduler (optional)
ENABLE_SCHEDULER=true
SCAN_TIMES=0 9,15,21 * * *
TIMEZONE=America/New_York
```

### 3. Run Development Server

```bash
npm run dev
```

The server will:
- Initialize SQLite database
- Start automated scheduler (if enabled)
- Begin caching system
- Listen on http://localhost:3002

---

## ⏰ Automated Scheduling

The scheduler runs automatically on startup and performs scans at configured times.

### Default Schedule
- **9:00 AM EST** - Morning scan
- **3:00 PM EST** - Afternoon scan  
- **9:00 PM EST** - Evening scan

### Custom Schedule

Edit `SCAN_TIMES` in `.env` using cron format:

```env
# Every 6 hours
SCAN_TIMES=0 */6 * * *

# Noon daily
SCAN_TIMES=0 12 * * *

# Multiple times
SCAN_TIMES=0 8,12,16,20 * * *
```

### Manual Scan

Admins can trigger manual scans via API:

```bash
POST /api/scan
Authorization: Bearer <token>
```

---

## 📊 Data Structure

### Pick Fields
```json
{
  "rank": 1,
  "confidence": 95,
  "sport": "NBA",
  "teams": "Lakers vs Warriors",
  "gameTime": "8:00 PM EST",
  "gameDate": "2025-11-06",
  "pick": "Lakers ML (-150)",
  "poster": "username",
  "posterRecord": "25-5-1",
  "posterWinRate": "83.3%",
  "originalComment": "Full Reddit comment text...",
  "reasoning": "Lakers dominating at home...",
  "keyFactors": ["Home court", "Injuries", "Recent form"],
  "riskLevel": "low",
  "result": "pending"
}
```

---

## 🔌 API Endpoints

### Public Endpoints

#### Get Today's Picks
```http
GET /api/picks/today
```
Returns today's analyzed picks (cached for 5 minutes).

#### Health Check
```http
GET /health
```
Server status, scheduler status, and cache stats.

#### Login
```http
POST /api/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_password"
}
```
Returns JWT token for protected endpoints.

---

### Protected Endpoints (Require JWT)

#### Force New Scan
```http
POST /api/scan
Authorization: Bearer <token>
```

#### Get Archives
```http
GET /api/archives?limit=50&offset=0
Authorization: Bearer <token>
```

#### Get Scan Details
```http
GET /api/archives/:scanId
Authorization: Bearer <token>
```

#### Update Pick Result
```http
POST /api/picks/:pickId/result
Authorization: Bearer <token>
Content-Type: application/json

{
  "result": "won", // or "lost", "push"
  "notes": "Optional notes"
}
```

#### Chat with Grok
```http
POST /api/chat
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "What's the best pick today?"
}
```

#### Get Stats
```http
GET /api/stats
Authorization: Bearer <token>
```
Returns comprehensive stats: overall, by sport, top posters.

#### Scheduler Controls
```http
POST /api/scheduler/start
POST /api/scheduler/stop
GET /api/scheduler/status
GET /api/scheduler/logs
Authorization: Bearer <token>
```

#### Cache Management
```http
POST /api/cache/clear
GET /api/cache/stats
Authorization: Bearer <token>
```

---

## 💾 Database

**SQLite with WAL mode** for optimal performance.

### Tables

- **picks** - Individual betting picks with full details
- **scans** - Historical scan records
- **chat_history** - AI chat conversations
- **scheduler_log** - Automated scan logs

### Optimization Features

- Write-Ahead Logging (WAL) for better concurrency
- Indexed queries for fast lookups
- Batch inserts with transactions
- Automatic VACUUM and ANALYZE on shutdown

---

## 🚀 Performance Features

### Caching Strategy

- **Today's Picks**: 5 minutes
- **Stats**: 10 minutes  
- **Archives**: 30 minutes
- **Chat History**: 5 minutes

Cache is automatically invalidated when data changes.

### Compression

All API responses are gzip compressed.

### Database Optimization

- WAL mode for better writes
- In-memory temp storage
- Large page cache (10MB)
- Indexed queries

---

## 📈 How It Works

1. **Scheduler triggers** at configured time
2. **Fetch Reddit** data from r/sportsbook POTD thread
3. **Extract ALL comments** with verified win/loss records
4. **Analyze with Grok** - AI ranks picks by confidence
5. **Parse JSON response** with all required fields
6. **Save to database** with full metadata
7. **Cache results** for fast API access
8. **Serve to frontend** via REST API

---

## 🔧 Development

### Watch Mode
```bash
npm run dev
```
Auto-restarts on file changes.

### Production
```bash
npm start
```

### Environment Variables

- `ENABLE_SCHEDULER` - Enable/disable automated scans
- `SCAN_TIMES` - Cron schedule for scans
- `TIMEZONE` - Timezone for scheduler
- `NODE_ENV` - Development or production mode

---

## 📦 Dependencies

- **express** - Web framework
- **better-sqlite3** - Fast SQLite database
- **node-cron** - Task scheduler
- **node-cache** - In-memory caching
- **compression** - Response compression
- **jsonwebtoken** - JWT authentication
- **bcrypt** - Password hashing
- **node-fetch** - HTTP client

---

## 🎯 Key Improvements from v1.0

| Feature | v1.0 | v2.0 |
|---------|------|------|
| Comment Fetching | Limited | **ALL comments with pagination** |
| Scheduling | Manual only | **Automated with cron** |
| Data Structure | Text parsing | **Structured JSON from AI** |
| Caching | None | **Multi-layer with TTL** |
| Pick Fields | Basic | **Comprehensive (12+ fields)** |
| Performance | Good | **Optimized with compression** |
| AI Analysis | Simple ranking | **Detailed reasoning + factors** |

---

## 🚢 Deployment

### Vercel (Recommended)

1. Install Vercel Postgres add-on
2. Set environment variables in dashboard
3. Deploy:

```bash
vercel deploy
```

### Manual Deployment

```bash
# Build and start
npm install --production
npm start
```

---

## 📝 Notes

- SQLite database file: `picksync.db`
- Logs stored in `scheduler_log` table
- Cache is in-memory (clears on restart)
- Default admin credentials in `.env`

---

## 🔐 Security

- JWT token authentication
- Bcrypt password hashing
- Protected admin endpoints
- Environment variable secrets
- CORS enabled for frontend

---

## 🤝 Support

For issues or questions, check the logs:
- Server logs show all operations
- Scheduler logs in database
- Cache stats via API

---

**Built with ⚡ by the Picksync team**
