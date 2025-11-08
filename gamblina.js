import fetch from 'node-fetch';
import crypto from 'crypto';
import { getCache, setCache } from './cache.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GAMBLINA_MODEL = process.env.GAMBLINA_MODEL || 'x-ai/grok-4';
const GAMBLINA_TEMPERATURE = parseFloat(process.env.GAMBLINA_TEMPERATURE) || 0.3;
const GAMBLINA_MAX_TOKENS = 8000;
const BATCH_SIZE = 45;

let gamblinaCallsThisMonth = 0;

export async function analyzeWithGamblina(allComments) {
  console.log('\n💋 Starting Gamblina AI Analysis...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Total Comments: ${allComments.length}`);
  console.log(`📊 With Records: ${allComments.filter(c => c.record).length}`);
  console.log(`⚙️  Model: ${GAMBLINA_MODEL}`);
  console.log(`⚙️  Max Tokens: ${GAMBLINA_MAX_TOKENS}`);

  if (allComments.length === 0) {
    return { analyzedPicks: [], totalAnalyzed: 0, tokensUsed: 0 };
  }

  const needsBatching = allComments.length > BATCH_SIZE;
  const numBatches = needsBatching ? Math.ceil(allComments.length / BATCH_SIZE) : 1;
  
  if (needsBatching) {
    console.log(`📦 Large comment volume - splitting into ${numBatches} batches`);
    console.log(`   Batch size: ${BATCH_SIZE} comments each`);
  }

  let allPicks = [];
  let totalTokens = 0;

  for (let batchNum = 0; batchNum < numBatches; batchNum++) {
    const start = batchNum * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allComments.length);
    const batchComments = allComments.slice(start, end);
    
    if (needsBatching) {
      console.log(`\n📦 Batch ${batchNum + 1}/${numBatches} (${batchComments.length} comments)...`);
    }

    const commentHash = crypto
      .createHash('md5')
      .update(JSON.stringify(batchComments.map(c => ({ author: c.author, text: c.text }))))
      .digest('hex');
    
    const cacheKey = `gamblina:batch:${commentHash}`;
    
    const cached = getCache(cacheKey);
    if (cached) {
      console.log(`✨ Using cached analysis for batch ${batchNum + 1}`);
      allPicks.push(...cached.picks);
      continue;
    }

    const result = await analyzeBatch(batchComments, batchNum + 1, numBatches);
    allPicks.push(...result.picks);
    totalTokens += result.tokensUsed;
    
    setCache(cacheKey, { picks: result.picks }, 3600);
    
    if (batchNum < numBatches - 1) {
      console.log('⏳ Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('🔍 Enriching picks with comment data...');
  const enrichedPicks = allPicks.map((pick, index) => {
    const original = allComments.find(c => c.author === pick.poster);
    
    return {
      rank: index + 1,
      confidence: pick.confidence || 50,
      sport: pick.sport || 'Unknown',
      event: pick.teams || pick.event || 'Unknown',
      pick: pick.pick || '',
      odds: extractOdds(pick.pick) || null,
      units: pick.units || 1.0,
      comment_score: original?.score || 0,
      comment_author: pick.poster || 'unknown',
      comment_body: original?.text || '',
      comment_url: `https://reddit.com/r/sportsbook/comments/${original?.commentId || ''}`,
      reasoning: (pick.reasoning || '') + (pick.keyFactors ? ' | ' + pick.keyFactors.join(', ') : ''),
      risk_factors: pick.riskLevel || 'medium',
      ai_analysis: JSON.stringify({
        confidence: pick.confidence,
        reasoning: pick.reasoning,
        keyFactors: pick.keyFactors,
        riskLevel: pick.riskLevel
      }),
      user_record: pick.posterRecord || original?.record || null,
      game_time: pick.gameTime || null,
      game_date: pick.gameDate || null,
    };
  });
  
  function extractOdds(pickText) {
    const oddsMatch = pickText?.match(/([+-]\d+)|\((\d+\.\d+)\)/);
    return oddsMatch ? oddsMatch[0] : null;
  }
  
  enrichedPicks.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Gamblina Analysis Complete!`);
  console.log(`   Total Picks: ${enrichedPicks.length}`);
  console.log(`   Batches: ${numBatches}`);
  console.log(`   Tokens: ${totalTokens}`);
  console.log(`   API Calls This Month: ${gamblinaCallsThisMonth}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  return {
    analyzedPicks: enrichedPicks,
    totalAnalyzed: enrichedPicks.length,
    tokensUsed: totalTokens,
    gamblinaCallsThisMonth,
  };
}

async function analyzeBatch(batchComments, batchNum, totalBatches) {
  const formattedComments = batchComments.map((comment, index) => ({
    id: index + 1,
    author: comment.author,
    record: comment.record || null,
    winRate: comment.winRate ? comment.winRate.toFixed(1) : null,
    score: comment.score,
    text: comment.text.substring(0, 800),
  }));

  const prompt = `You're GAMBLINA 💋 - A professional sports gambler and sharp bettor with 10+ years of experience in the industry. You've made a living reading lines, finding edges, and exploiting variance. You're ANALYTICAL, SHARP, and you smell BULLSHIT from a mile away.

ANALYZE ${batchComments.length} Reddit r/sportsbook POTD comments${totalBatches > 1 ? ` (Batch ${batchNum}/${totalBatches})` : ''} like a PROFESSIONAL handicapper would.

CONFIDENCE SCORING (Extract ALL picks, rate honestly):
85-100% LOCK 🔒 - Elite capper (>70% win rate) + Multiple edges
70-84% STRONG 💪 - Good capper (60-70% win rate) + Solid analysis
55-69% DECENT ✓ - Average capper OR reasonable analysis
40-54% LEAN 📊 - Casual pick with basic reasoning

JSON FORMAT:
[{
  "poster": "username",
  "posterRecord": "45-15-2" or null,
  "posterWinRate": "75.0" or null,
  "sport": "NBA/NFL/NHL/Soccer/MLB/Tennis/etc",
  "teams": "Team A vs Team B",
  "gameTime": "7:30 PM EST" or null,
  "gameDate": "2025-11-08",
  "pick": "Lakers -2.5 (-110)",
  "confidence": 85,
  "reasoning": "40-80 words of SHARP analysis with stats and edges",
  "keyFactors": ["edge 1", "edge 2"],
  "riskLevel": "low/medium/high"
}]

INCLUDE ALL PICKS THAT HAVE:
✅ A specific game and bet type (ML/spread/total/props)
✅ ANY reasoning or analysis (even if brief)
✅ Track record OR logical explanation

Only EXCLUDE:
❌ Pure jokes with no actual bet
❌ Just questions with no pick
❌ Completely off-topic spam

REDDIT COMMENTS TO ANALYZE:
${JSON.stringify(formattedComments, null, 2)}

Return ONLY valid JSON array - no markdown, no text, just pure JSON:`;

  console.log(`📤 Sending batch ${batchNum} to Gamblina...`);
  console.log(`📏 Input tokens: ~${Math.ceil(prompt.length / 4)}`);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://picksync.app',
        'X-Title': 'Picksync Analysis - Gamblina Pro',
      },
      body: JSON.stringify({
        model: GAMBLINA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are GAMBLINA, a professional sports bettor. Return ONLY a valid JSON array - no markdown code blocks, no text before or after. Just the pure JSON array starting with [ and ending with ]. EXTRACT ALL LEGITIMATE PICKS from the comments - include every pick that has actual reasoning, even casual ones. Rate each honestly with accurate confidence scores. We want volume and accuracy.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: GAMBLINA_MAX_TOKENS,
        temperature: GAMBLINA_TEMPERATURE,
      }),
    });

    clearTimeout(timeout);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📥 Batch ${batchNum} response: ${response.status} (${duration}s)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gamblina API Error:', errorText);
      throw new Error(`Gamblina API error: ${response.status}`);
    }
    
    console.log('⏳ Parsing response...');
    
    const responseText = await response.text();
    console.log(`✅ Received ${responseText.length} bytes`);
    
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('✅ API response JSON parsed');
    } catch (jsonError) {
      console.error('❌ Failed to parse API response as JSON:', jsonError.message);
      console.error('📄 Response preview:', responseText.substring(0, 1000));
      throw new Error('Invalid JSON from Gamblina API');
    }
    
    if (!data.choices?.[0]) {
      console.error('❌ No choices in API response:', data);
      throw new Error('No response from Gamblina');
    }

    let content = data.choices[0].message.content;
    console.log('📄 Content length:', content.length);
    console.log('📄 Content preview (first 200 chars):', content.substring(0, 200));
    
    // Clean markdown AGGRESSIVELY
    content = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    // Remove any leading/trailing text outside of JSON
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    
    if (jsonStart === -1 || jsonEnd === 0) {
      console.error('❌ No JSON array found in content');
      console.error('📄 Full content:', content);
      throw new Error('No JSON array in Grok response');
    }
    
    content = content.substring(jsonStart, jsonEnd);
    console.log('✅ Extracted JSON array, length:', content.length);
    
    // Parse picks JSON
    let picks;
    try {
      const parsed = JSON.parse(content);
      picks = Array.isArray(parsed) ? parsed : (parsed.picks || []);
      console.log(`✅ Batch ${batchNum}: ${picks.length} picks extracted`);
    } catch (parseError) {
      console.error('❌ Failed to parse picks JSON:', parseError.message);
      console.error('📄 Content that failed to parse (first 1000 chars):', content.substring(0, 1000));
      throw new Error(`Failed to parse Gamblina response: ${parseError.message}`);
    }
    
    gamblinaCallsThisMonth++;
    
    const tokensUsed = data.usage?.total_tokens || 0;
    
    if (data.usage) {
      console.log(`📊 Batch ${batchNum} tokens: ${tokensUsed} (${data.usage.prompt_tokens} in + ${data.usage.completion_tokens} out)`);
    }
    
    return { picks, tokensUsed };
    
  } catch (error) {
    console.error(`❌ Batch ${batchNum} error:`, error.message);
    console.error(`❌ Stack trace:`, error.stack);
    throw error;
  }
}

export async function chatWithGamblina(userMessage, context) {
  const systemPrompt = `You're GAMBLINA 💋, a professional sports bettor and sharp handicapper with 10+ years making a living from betting.

Current Stats: ${context.stats?.won || 0}W-${context.stats?.lost || 0}L-${context.stats?.push || 0}P
Record: ${context.stats?.total > 0 ? ((context.stats.won / context.stats.total) * 100).toFixed(1) : 0}% hit rate
Today's Picks: ${context.recentPicks?.length || 0}

YOUR PERSONALITY:
- Sharp and analytical (you live by the numbers)
- Confident but not cocky
- Sassy when people ask dumb questions
- You respect bankroll management
- You hate public bettors who chase
- You love finding contrarian value

TALK LIKE A PRO:
- Use betting terminology (RLM, steam, sharp action, public fade, overlay, etc.)
- Reference actual concepts (line movement, injury reports, rest spots, lookaheads)
- Keep it real - no false confidence
- 2-4 sentences max
- Add personality with emojis (💅💋🔥💰📊)

You're the smartest person in the room. Act like it.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://picksync.app',
        'X-Title': 'Picksync Chat - Gamblina',
      },
      body: JSON.stringify({
        model: GAMBLINA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    gamblinaCallsThisMonth++;
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('❌ Error chatting with Gamblina:', error.message);
    throw error;
  }
}

export function getGamblinaUsageStats() {
  return {
    callsThisMonth: gamblinaCallsThisMonth,
    estimatedMonthlyCost: gamblinaCallsThisMonth * 0.02,
  };
}
