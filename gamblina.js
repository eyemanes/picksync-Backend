import fetch from 'node-fetch';
import crypto from 'crypto';
import { getCache, setCache } from './cache.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GAMBLINA_MODEL = process.env.GAMBLINA_MODEL || 'x-ai/grok-4';
const GAMBLINA_TEMPERATURE = parseFloat(process.env.GAMBLINA_TEMPERATURE) || 0.3;
const GAMBLINA_MAX_TOKENS = 4000; // REDUCED from 8000 to get faster responses
const BATCH_SIZE = 25; // REDUCED from 45 to make smaller batches

let gamblinaCallsThisMonth = 0;

export async function analyzeWithGamblina(allComments) {
  console.log('\n💋 Starting Gamblina AI Analysis...');
  console.log(`📊 Total Comments: ${allComments.length}`);
  console.log(`📊 With Records: ${allComments.filter(c => c.record).length}`);

  if (allComments.length === 0) {
    return { analyzedPicks: [], totalAnalyzed: 0, tokensUsed: 0 };
  }

  const needsBatching = allComments.length > BATCH_SIZE;
  const numBatches = needsBatching ? Math.ceil(allComments.length / BATCH_SIZE) : 1;
  
  if (needsBatching) {
    console.log(`📦 Splitting into ${numBatches} batches (${BATCH_SIZE} each)`);
  }

  let allPicks = [];
  let totalTokens = 0;

  for (let batchNum = 0; batchNum < numBatches; batchNum++) {
    const start = batchNum * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allComments.length);
    const batchComments = allComments.slice(start, end);
    
    console.log(`\n📦 Batch ${batchNum + 1}/${numBatches} (${batchComments.length} comments)...`);

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

    try {
      const result = await analyzeBatch(batchComments, batchNum + 1, numBatches);
      allPicks.push(...result.picks);
      totalTokens += result.tokensUsed;
      
      // Cache successful result
      setCache(cacheKey, { picks: result.picks }, 3600);
    } catch (error) {
      console.error(`❌ Batch ${batchNum + 1} failed: ${error.message}`);
      console.error(`   Continuing with remaining batches...`);
      // DON'T throw - continue with other batches
    }
    
    if (batchNum < numBatches - 1) {
      console.log('⏳ Waiting 1s before next batch...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`🔍 Enriching ${allPicks.length} picks with comment data...`);
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
    score: comment.score,
    text: comment.text.substring(0, 500), // REDUCED from 800
  }));

  const prompt = `Analyze ${batchComments.length} Reddit sports betting comments. Extract ALL picks with reasoning.

CONFIDENCE LEVELS:
85-100: Elite capper (>70% win rate) + strong analysis
70-84: Good capper (60-70%) + solid reasoning  
55-69: Average capper + decent logic
40-54: Casual pick + basic reasoning

INCLUDE: Any pick with a specific game/bet and reasoning
EXCLUDE: Jokes, questions, spam

COMMENTS:
${JSON.stringify(formattedComments, null, 2)}

Return ONLY this JSON format (no markdown, no text):
[{"poster":"user","posterRecord":"10-5","sport":"NBA","teams":"Lakers vs Warriors","pick":"Lakers -2.5","confidence":75,"reasoning":"short analysis","keyFactors":["factor1","factor2"],"riskLevel":"medium"}]`;

  console.log(`📤 Sending batch ${batchNum} to Gamblina...`);

  const startTime = Date.now();

  try {
    // FETCH with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

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
        model: GAMBLINA_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a sports betting analyst. Return ONLY valid JSON array with no markdown, no text before or after. Extract ALL picks with reasoning from comments.'
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
    
    console.log('⏳ Reading response body...');
    
    // READ RESPONSE TEXT WITH TIMEOUT
    const textPromise = response.text();
    const textTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('response.text() timeout after 10s')), 10000)
    );
    
    const responseText = await Promise.race([textPromise, textTimeout]);
    
    console.log(`✅ Body read: ${responseText.length} bytes`);
    
    // PARSE API RESPONSE
    let data;
    try {
      data = JSON.parse(responseText);
      console.log('✅ API JSON parsed');
    } catch (jsonError) {
      console.error('❌ Invalid API JSON:', jsonError.message);
      console.error('📄 Response preview:', responseText.substring(0, 500));
      throw new Error('Invalid JSON from API');
    }
    
    if (!data.choices?.[0]) {
      console.error('❌ No choices in response');
      throw new Error('No response from Gamblina');
    }

    let content = data.choices[0].message.content;
    console.log('📄 Content length:', content.length);
    console.log('📄 First 150 chars:', content.substring(0, 150));
    
    // CLEAN CONTENT
    content = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    // EXTRACT JSON ARRAY
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    
    if (jsonStart === -1 || jsonEnd === 0) {
      console.error('❌ No JSON array in content');
      console.error('📄 Full content:', content);
      throw new Error('No JSON array found');
    }
    
    content = content.substring(jsonStart, jsonEnd);
    console.log(`✅ Extracted JSON: ${content.length} chars`);
    
    // PARSE PICKS
    let picks;
    try {
      const parsed = JSON.parse(content);
      picks = Array.isArray(parsed) ? parsed : (parsed.picks || []);
      console.log(`✅ Batch ${batchNum}: ${picks.length} picks extracted`);
    } catch (parseError) {
      console.error('❌ Failed to parse picks:', parseError.message);
      console.error('📄 Content (first 500):', content.substring(0, 500));
      throw new Error(`Parse error: ${parseError.message}`);
    }
    
    gamblinaCallsThisMonth++;
    
    const tokensUsed = data.usage?.total_tokens || 0;
    
    if (data.usage) {
      console.log(`📊 Tokens: ${tokensUsed} (${data.usage.prompt_tokens} in + ${data.usage.completion_tokens} out)`);
    }
    
    return { picks, tokensUsed };
    
  } catch (error) {
    console.error(`❌ Batch ${batchNum} error:`, error.message);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - Grok took too long');
    }
    throw error;
  }
}

export async function chatWithGamblina(userMessage, context) {
  const systemPrompt = `You're GAMBLINA 💋, a professional sports bettor.

Stats: ${context.stats?.won || 0}W-${context.stats?.lost || 0}L-${context.stats?.push || 0}P
Hit rate: ${context.stats?.total > 0 ? ((context.stats.won / context.stats.total) * 100).toFixed(1) : 0}%

Talk like a sharp bettor. 2-4 sentences. Use emojis 💅💋🔥💰`;

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
        model: GAMBLINA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 300,
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    gamblinaCallsThisMonth++;
    
    return data.choices[0].message.content;
  } catch (error) {
    console.error('❌ Chat error:', error.message);
    throw error;
  }
}

export function getGamblinaUsageStats() {
  return {
    callsThisMonth: gamblinaCallsThisMonth,
    estimatedMonthlyCost: gamblinaCallsThisMonth * 0.02,
  };
}
