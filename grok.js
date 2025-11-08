import fetch from 'node-fetch';
import crypto from 'crypto';
import { getCache, setCache } from './cache.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GROK_MODEL = process.env.GROK_MODEL || 'x-ai/grok-4';
const GROK_TEMPERATURE = parseFloat(process.env.GROK_TEMPERATURE) || 0.3;
const GROK_MAX_TOKENS = 6000; // Increased back since we're batching
const BATCH_SIZE = 45; // Process 45 comments per batch

// Track Grok usage
let grokCallsThisMonth = 0;

// Main function with intelligent batching
export async function analyzeWithGrok(allComments) {
  console.log('\n🤖 Starting Grok AI Analysis...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Total Comments: ${allComments.length}`);
  console.log(`📊 With Records: ${allComments.filter(c => c.record).length}`);
  console.log(`⚙️  Model: ${GROK_MODEL}`);
  console.log(`⚙️  Max Tokens: ${GROK_MAX_TOKENS}`);

  if (allComments.length === 0) {
    return { analyzedPicks: [], totalAnalyzed: 0, tokensUsed: 0 };
  }

  // Determine if we need batching
  const needsBatching = allComments.length > BATCH_SIZE;
  const numBatches = needsBatching ? Math.ceil(allComments.length / BATCH_SIZE) : 1;
  
  if (needsBatching) {
    console.log(`📦 Large comment volume - splitting into ${numBatches} batches`);
    console.log(`   Batch size: ${BATCH_SIZE} comments each`);
  }

  let allPicks = [];
  let totalTokens = 0;

  // Process in batches
  for (let batchNum = 0; batchNum < numBatches; batchNum++) {
    const start = batchNum * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allComments.length);
    const batchComments = allComments.slice(start, end);
    
    if (needsBatching) {
      console.log(`\n📦 Batch ${batchNum + 1}/${numBatches} (${batchComments.length} comments)...`);
    }

    // Create cache key from batch content
    const commentHash = crypto
      .createHash('md5')
      .update(JSON.stringify(batchComments.map(c => ({ author: c.author, text: c.text }))))
      .digest('hex');
    
    const cacheKey = `grok:batch:${commentHash}`;
    
    // Check cache first
    const cached = getCache(cacheKey);
    if (cached) {
      console.log(`✨ Using cached analysis for batch ${batchNum + 1}`);
      allPicks.push(...cached.picks);
      continue;
    }

    // Analyze this batch
    const result = await analyzeBatch(batchComments, batchNum + 1, numBatches);
    allPicks.push(...result.picks);
    totalTokens += result.tokensUsed;
    
    // Cache this batch
    setCache(cacheKey, { picks: result.picks }, 3600);
    
    // Rate limit between batches
    if (batchNum < numBatches - 1) {
      console.log('⏳ Waiting 2s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Enrich with original comment data
  console.log('🔍 Enriching picks with comment data...');
  const enrichedPicks = allPicks.map((pick, index) => {
    const original = allComments.find(c => c.author === pick.poster);
    return {
      ...pick,
      rank: index + 1,
      originalComment: original?.text || '',
      commentScore: original?.score || 0,
    };
  });
  
  // Sort by confidence
  enrichedPicks.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Grok Analysis Complete!`);
  console.log(`   Total Picks: ${enrichedPicks.length}`);
  console.log(`   Batches: ${numBatches}`);
  console.log(`   Tokens: ${totalTokens}`);
  console.log(`   API Calls This Month: ${grokCallsThisMonth}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  return {
    analyzedPicks: enrichedPicks,
    totalAnalyzed: enrichedPicks.length,
    tokensUsed: totalTokens,
    grokCallsThisMonth,
  };
}

// Analyze a single batch
async function analyzeBatch(batchComments, batchNum, totalBatches) {
  // Format comments concisely
  const formattedComments = batchComments.map((comment, index) => ({
    id: index + 1,
    author: comment.author,
    record: comment.record || null,
    winRate: comment.winRate ? comment.winRate.toFixed(1) : null,
    score: comment.score,
    text: comment.text.substring(0, 600),
  }));

  const prompt = `Analyze ${batchComments.length} Reddit r/sportsbook POTD comments${totalBatches > 1 ? ` (Batch ${batchNum}/${totalBatches})` : ''}. Extract EVERY legitimate betting pick.

CRITICAL - ULTRA-CONCISE JSON:
- reasoning: MAX 6 words
- keyFactors: MAX 2 items, 4 words each
- Extract ALL picks (15-25 typical per batch)
- ONLY valid JSON, no explanations

INCLUDE if:
✅ Specific game + bet type (ML/spread/total/prop)
✅ Informal picks ("I like X", "Taking Y")
✅ Any pick with reasoning

EXCLUDE only:
❌ Pure questions
❌ Off-topic/spam
❌ Jokes with no bet

JSON FORMAT:
[{
  "poster": "username",
  "posterRecord": "25-5" or null,
  "posterWinRate": "83.3" or null,
  "sport": "NBA/NFL/NHL/Soccer/etc",
  "teams": "Team A vs Team B",
  "gameTime": "8PM EST" or null,
  "gameDate": "2025-11-06",
  "pick": "Lakers ML (-150)",
  "confidence": 75,
  "reasoning": "Max 6 words here",
  "keyFactors": ["4 words max", "4 words max"],
  "riskLevel": "low/medium/high"
}]

CONFIDENCE SCORING:
- 85-100: Elite record (>70%) + strong analysis
- 70-84: Good record (60-70%) OR detailed analysis
- 60-69: Average/no record but solid pick

COMMENTS:
${JSON.stringify(formattedComments, null, 2)}

Return ONLY JSON array with all picks:`;

  console.log(`📤 Sending batch ${batchNum} to Grok...`);
  console.log(`📏 Input tokens: ~${Math.ceil(prompt.length / 4)}`);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://picksync.app',
        'X-Title': 'Picksync Analysis',
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a sports betting analyst. Return ONLY valid JSON array. NO text before/after. Ultra-concise: 6-word reasoning, 4-word factors. Extract ALL legitimate picks.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: GROK_MAX_TOKENS,
        temperature: GROK_TEMPERATURE,
      }),
    });

    clearTimeout(timeout);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📥 Batch ${batchNum} response: ${response.status} (${duration}s)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Grok API Error:', errorText);
      throw new Error(`Grok API error: ${response.status}`);
    }
    
    console.log('⏳ Parsing response...');
    
    const responseText = await response.text();
    console.log(`✅ Received ${responseText.length} bytes`);
    
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('✅ API response parsed');
    } catch (jsonError) {
      console.error('❌ Invalid API response:', jsonError.message);
      throw new Error('Invalid JSON from Grok API');
    }
    
    if (!data.choices?.[0]) {
      throw new Error('No response from Grok');
    }

    let content = data.choices[0].message.content;
    
    // Clean markdown
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Parse picks JSON
    let picks;
    try {
      const parsed = JSON.parse(content);
      picks = Array.isArray(parsed) ? parsed : (parsed.picks || []);
      console.log(`✅ Batch ${batchNum}: ${picks.length} picks extracted`);
    } catch (parseError) {
      console.error('❌ Failed to parse picks:', parseError.message);
      console.error('📄 Content preview:', content.substring(0, 500));
      throw new Error('Failed to parse Grok response');
    }
    
    grokCallsThisMonth++;
    
    const tokensUsed = data.usage?.total_tokens || 0;
    
    if (data.usage) {
      console.log(`📊 Batch ${batchNum} tokens: ${tokensUsed} (${data.usage.prompt_tokens} in + ${data.usage.completion_tokens} out)`);
    }
    
    return { picks, tokensUsed };
    
  } catch (error) {
    console.error(`❌ Batch ${batchNum} error:`, error.message);
    throw error;
  }
}

// Chat with Grok
export async function chatWithGrok(userMessage, context) {
  const systemPrompt = `You're Grok, a sharp betting AI. Be direct and concise.

Stats: ${context.stats?.won || 0}W-${context.stats?.lost || 0}L (${context.stats?.total || 0} tracked)
Recent picks: ${context.recentPicks?.length || 0} today

Answer in 2-3 sentences max. Use betting slang.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://picksync.app',
        'X-Title': 'Picksync Chat',
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    grokCallsThisMonth++;
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('❌ Error chatting with Grok:', error.message);
    throw error;
  }
}

// Get Grok usage stats
export function getGrokUsageStats() {
  return {
    callsThisMonth: grokCallsThisMonth,
    estimatedMonthlyCost: grokCallsThisMonth * 0.02,
  };
}
