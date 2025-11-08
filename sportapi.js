import https from 'https';
import db from './database.js';

const RAPIDAPI_KEY = 'ce2ff6bfd7mshb960de6e14c02e4p1617bbjsnc103c901546e';
const RAPIDAPI_HOST = 'sportapi7.p.rapidapi.com';

// Sport mapping for API
const SPORT_MAP = {
  'NBA': 'basketball',
  'Basketball': 'basketball',
  'NFL': 'american-football',
  'Football': 'american-football',
  'Soccer': 'football',
  'NCAAB': 'basketball',
  'NHL': 'ice-hockey',
  'Hockey': 'ice-hockey',
  'UFC': 'mma',
  'MMA': 'mma',
  'Boxing': 'boxing'
};

// Make API request
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      hostname: RAPIDAPI_HOST,
      port: null,
      path: path,
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      
      res.on('data', (chunk) => chunks.push(chunk));
      
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString();
          const data = JSON.parse(body);
          resolve(data);
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Search for a game by team names and date
export async function searchGame(sport, teams, gameDate) {
  try {
    const sportSlug = SPORT_MAP[sport] || 'basketball';
    const date = new Date(gameDate).toISOString().split('T')[0];
    
    console.log(`🔍 Searching Sport API: ${sportSlug} - ${teams} on ${date}`);
    
    // Get events for the date
    const data = await makeRequest(`/api/v1/sport/${sportSlug}/scheduled-events/${date}`);
    
    if (!data || !data.events) {
      console.log('❌ No events found in API response');
      return null;
    }

    // Extract team names from "Team A vs Team B" format
    const teamNames = teams.toLowerCase().split(/\s+vs\s+|\s+@\s+/);
    
    // Search for matching game
    const match = data.events.find(event => {
      const homeTeam = event.homeTeam?.name?.toLowerCase() || '';
      const awayTeam = event.awayTeam?.name?.toLowerCase() || '';
      
      // Check if both teams are in the game
      return teamNames.some(name => homeTeam.includes(name) || awayTeam.includes(name));
    });

    if (match) {
      console.log(`✅ Found match: ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      return {
        id: match.id,
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        homeScore: match.homeScore?.current || 0,
        awayScore: match.awayScore?.current || 0,
        status: match.status?.type || 'Not Started',
        startTime: match.startTimestamp
      };
    }

    console.log('❌ No matching game found');
    return null;
  } catch (error) {
    console.error('Sport API error:', error.message);
    return null;
  }
}

// Get result for a specific match
export async function getGameResult(matchId) {
  try {
    const data = await makeRequest(`/api/v1/event/${matchId}`);
    
    if (!data || !data.event) return null;

    const event = data.event;
    
    return {
      id: event.id,
      homeTeam: event.homeTeam?.name,
      awayTeam: event.awayTeam?.name,
      homeScore: event.homeScore?.current || 0,
      awayScore: event.awayScore?.current || 0,
      status: event.status?.type || 'Not Started',
      winnerCode: event.winnerCode // 1=home, 2=away, 3=draw
    };
  } catch (error) {
    console.error('Get result error:', error.message);
    return null;
  }
}

// Update all pending picks with Sport API data
export async function updatePickResults() {
  try {
    console.log('🔄 Updating pick results from Sport API...');
    
    // Get all pending picks
    const stmt = db.prepare(`
      SELECT id, sport, teams, game_date, pick, match_id
      FROM picks 
      WHERE result = 'pending'
      AND game_date IS NOT NULL
    `);
    const picks = stmt.all();
    
    console.log(`📊 Found ${picks.length} pending picks to check`);
    
    let updated = 0;
    let finished = 0;

    for (const pick of picks) {
      try {
        let gameData;

        // If we already have match_id, just get the result
        if (pick.match_id) {
          gameData = await getGameResult(pick.match_id);
        } else {
          // First time - search for the match
          gameData = await searchGame(pick.sport, pick.teams, pick.game_date);
          
          // Save match_id for future lookups
          if (gameData) {
            const updateStmt = db.prepare(`
              UPDATE picks 
              SET match_id = ?, home_score = ?, away_score = ?, match_status = ?
              WHERE id = ?
            `);
            updateStmt.run(
              gameData.id,
              gameData.homeScore,
              gameData.awayScore,
              gameData.status,
              pick.id
            );
          }
        }

        if (!gameData) continue;

        // Update status and scores
        const updateStatusStmt = db.prepare(`
          UPDATE picks 
          SET home_score = ?, away_score = ?, match_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateStatusStmt.run(
          gameData.homeScore,
          gameData.awayScore,
          gameData.status,
          pick.id
        );
        updated++;

        // If game finished, determine result
        if (gameData.status === 'Finished' || gameData.status === 'ended') {
          const result = determinePickResult(pick.pick, gameData);
          
          if (result) {
            const updateResultStmt = db.prepare(`
              UPDATE picks 
              SET result = ?, actual_outcome = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `);
            updateResultStmt.run(
              result.outcome,
              result.description,
              pick.id
            );
            finished++;
            console.log(`✅ Pick ${pick.id}: ${result.outcome} - ${result.description}`);
          }
        }

        // Rate limit - don't spam API
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`Error updating pick ${pick.id}:`, error.message);
      }
    }

    console.log(`✅ Updated ${updated} picks, ${finished} games finished`);
    return { updated, finished };
    
  } catch (error) {
    console.error('Update picks error:', error.message);
    throw error;
  }
}

// Determine if pick won/lost/push based on game result
function determinePickResult(pick, gameData) {
  try {
    const pickLower = pick.toLowerCase();
    const homeTeam = gameData.homeTeam.toLowerCase();
    const awayTeam = gameData.awayTeam.toLowerCase();
    const homeScore = gameData.homeScore;
    const awayScore = gameData.awayScore;

    // ML (Moneyline) pick
    if (pickLower.includes('ml') || pickLower.includes('moneyline')) {
      const pickedHome = pickLower.includes(homeTeam);
      const pickedAway = pickLower.includes(awayTeam);

      if (homeScore === awayScore) {
        return { outcome: 'push', description: `Draw ${homeScore}-${awayScore}` };
      }

      if (pickedHome) {
        return {
          outcome: homeScore > awayScore ? 'won' : 'lost',
          description: `${gameData.homeTeam} ${homeScore}-${awayScore}`
        };
      }

      if (pickedAway) {
        return {
          outcome: awayScore > homeScore ? 'won' : 'lost',
          description: `${gameData.awayTeam} ${awayScore}-${homeScore}`
        };
      }
    }

    // Spread pick
    const spreadMatch = pickLower.match(/([-+]?\d+\.?\d*)/);
    if (spreadMatch) {
      const spread = parseFloat(spreadMatch[1]);
      const pickedHome = pickLower.includes(homeTeam);
      
      if (pickedHome) {
        const coverMargin = homeScore - awayScore - spread;
        if (Math.abs(coverMargin) < 0.5) {
          return { outcome: 'push', description: `${gameData.homeTeam} ${spread} push` };
        }
        return {
          outcome: coverMargin > 0 ? 'won' : 'lost',
          description: `${gameData.homeTeam} ${spread} (${homeScore}-${awayScore})`
        };
      } else {
        const coverMargin = awayScore - homeScore - Math.abs(spread);
        if (Math.abs(coverMargin) < 0.5) {
          return { outcome: 'push', description: `${gameData.awayTeam} ${spread} push` };
        }
        return {
          outcome: coverMargin > 0 ? 'won' : 'lost',
          description: `${gameData.awayTeam} ${spread} (${awayScore}-${homeScore})`
        };
      }
    }

    // Over/Under
    if (pickLower.includes('over') || pickLower.includes('under')) {
      const totalMatch = pickLower.match(/(\d+\.?\d*)/);
      if (totalMatch) {
        const line = parseFloat(totalMatch[1]);
        const actualTotal = homeScore + awayScore;
        const isOver = pickLower.includes('over');

        if (actualTotal === line) {
          return { outcome: 'push', description: `Total ${actualTotal} push` };
        }

        if (isOver) {
          return {
            outcome: actualTotal > line ? 'won' : 'lost',
            description: `Over ${line} (${actualTotal})`
          };
        } else {
          return {
            outcome: actualTotal < line ? 'won' : 'lost',
            description: `Under ${line} (${actualTotal})`
          };
        }
      }
    }

    // Can't parse - manual review needed
    return null;

  } catch (error) {
    console.error('Error determining result:', error);
    return null;
  }
}
