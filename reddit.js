import fetch from 'node-fetch';

const RAPIDAPI_HOST = 'reddit34.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// Configuration from environment
const REDDIT_COMMENT_SORT = process.env.REDDIT_COMMENT_SORT || 'top';
const RATE_LIMIT = parseInt(process.env.REDDIT_RATE_LIMIT) || 20;

// Rate limiting
let lastRequestTime = 0;
const minRequestInterval = 60000 / RATE_LIMIT; // Milliseconds between requests

async function rateLimitedFetch(url, options) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < minRequestInterval) {
    const delay = minRequestInterval - timeSinceLastRequest;
    console.log(`⏳ Rate limiting: waiting ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Fetch posts from r/sportsbook
export async function fetchRedditPosts() {
  try {
    console.log('📡 Fetching posts from r/sportsbook (hot, past day)...');
    
    const response = await rateLimitedFetch(
      `https://${RAPIDAPI_HOST}/getPostsBySubreddit?subreddit=sportsbook&sort=hot&time=day`,
      {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': RAPIDAPI_HOST,
        },
      }
    );

    const data = await response.json();
    const posts = data.data?.posts || [];
    console.log(`📊 Fetched ${posts.length} posts`);
    
    if (process.env.LOG_API_USAGE === 'true') {
      console.log(`📈 API Usage: 1 request (getPostsBySubreddit)`);
    }
    
    return posts;
  } catch (error) {
    console.error('❌ Error fetching Reddit posts:', error.message);
    throw error;
  }
}

// Find the Pick of the Day post
export function findPOTDPost(posts) {
  const potdRegex = /pick\s+of\s+the\s+day|potd/i;
  
  for (const post of posts) {
    const title = post.data?.title || post.title || '';
    if (potdRegex.test(title)) {
      console.log(`✅ Found POTD: "${title}"`);
      
      const permalink = post.data?.permalink || post.permalink || '';
      const url = `https://www.reddit.com${permalink}`;
      
      return {
        title,
        url,
        post
      };
    }
  }
  
  console.log('❌ No POTD post found');
  return null;
}

// Fetch ALL comments (Grok will filter them)
export async function fetchAllComments(postUrl) {
  try {
    console.log(`🔗 Fetching ALL comments from: ${postUrl}`);
    console.log(`📊 Sort: ${REDDIT_COMMENT_SORT} | No limit - Grok will filter`);
    
    const encodedUrl = encodeURIComponent(postUrl);
    const response = await rateLimitedFetch(
      `https://${RAPIDAPI_HOST}/getPostCommentsWithSort?post_url=${encodedUrl}&sort=${REDDIT_COMMENT_SORT}`,
      {
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': RAPIDAPI_HOST,
        },
      }
    );

    const data = await response.json();
    
    console.log('🔍 DEBUG: API Response:');
    console.log('   Response status:', response.status);
    console.log('   data.success:', data.success);
    console.log('   Has data.data.comments:', !!data.data?.comments);
    console.log('   Comments array length:', data.data?.comments?.length || 0);
    
    if (!data.success) {
      console.log('⚠️  API returned success: false');
      return [];
    }
    
    // API returns: data.data.comments (array of comment objects with nested replies)
    const commentsArray = data.data?.comments || [];
    
    if (commentsArray.length === 0) {
      console.log('⚠️  No comments found');
      return [];
    }
    
    // Flatten all comments including nested replies
    function flattenComments(comments, result = []) {
      for (const comment of comments) {
        // Add this comment
        result.push({
          data: {
            body: comment.text || '',
            author: comment.author || 'unknown',
            score: comment.score || 0,
            id: comment.id || '',
            created_utc: 0, // Not provided in this API format
          }
        });
        
        // Recursively add replies
        if (comment.replies && Array.isArray(comment.replies)) {
          flattenComments(comment.replies, result);
        }
      }
      return result;
    }
    
    const allComments = flattenComments(commentsArray);
    
    console.log(`📊 Extracted ${allComments.length} total comments (including replies)`);
    
    if (process.env.LOG_API_USAGE === 'true') {
      console.log(`📈 API Usage: 1 request (getPostCommentsWithSort)`);
    }
    
    return allComments;
    
  } catch (error) {
    console.error('❌ Error fetching comments:', error.message);
    throw error;
  }
}

// Extract ALL comment data (minimal processing - let Grok do the work)
export function extractAllCommentData(comments) {
  console.log(`🔍 Preparing ${comments.length} comments for Grok analysis...`);
  
  const commentData = comments.map(comment => {
    const text = comment.data?.body || comment.body || '';
    const author = comment.data?.author || comment.author || 'unknown';
    const score = comment.data?.score || comment.score || 0;
    const commentId = comment.data?.id || comment.id || '';
    const created = comment.data?.created_utc || comment.created_utc || 0;
    
    // Extract record pattern if exists (but DON'T filter)
    const recordMatch = text.match(/(?:record[:\s]*)?(\d+)[-–](\d+)(?:[-–](\d+))?/i);
    
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let winRate = 0;
    let record = null;
    
    if (recordMatch) {
      wins = parseInt(recordMatch[1]);
      losses = parseInt(recordMatch[2]);
      pushes = recordMatch[3] ? parseInt(recordMatch[3]) : 0;
      
      const total = wins + losses;
      winRate = total > 0 ? (wins / total) * 100 : 0;
      record = pushes > 0 ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`;
    }
    
    return {
      commentId,
      text,
      author,
      score,
      created,
      wins,
      losses,
      pushes,
      winRate,
      record,
    };
  });
  
  const withRecords = commentData.filter(c => c.record).length;
  console.log(`✅ Prepared ${commentData.length} comments (${withRecords} with records)`);
  console.log(`📊 Sending ALL to Grok - NO pre-filtering`);
  
  return commentData;
}

// Main function: Get POTD data
export async function getPOTDData() {
  try {
    console.log('\n📡 Starting POTD data collection (OPTIMIZED)...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⚙️  Settings:`);
    console.log(`   Fetch: ALL comments (no limit)`);
    console.log(`   Comment Sort: ${REDDIT_COMMENT_SORT}`);
    console.log(`   Rate Limit: ${RATE_LIMIT} req/min`);
    console.log(`   Filtering: Grok AI handles all filtering`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const startTime = Date.now();
    let apiCallsUsed = 0;
    
    console.log('📡 Fetching posts from r/sportsbook...');
    const posts = await fetchRedditPosts();
    apiCallsUsed++;

    console.log('🔍 Looking for POTD post...');
    const potdData = findPOTDPost(posts);
    
    if (!potdData) {
      throw new Error('POTD post not found');
    }

    console.log(`📡 Fetching ALL comments...`);
    const allComments = await fetchAllComments(potdData.url);
    apiCallsUsed++;
    
    console.log(`🔍 Extracting comment data for Grok...`);
    const commentData = extractAllCommentData(allComments);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ POTD Data Collection Complete!`);
    console.log(`   Title: ${potdData.title}`);
    console.log(`   URL: ${potdData.url}`);
    console.log(`   Comments Fetched: ${allComments.length}`);
    console.log(`   Comments with Records: ${commentData.filter(c => c.record).length}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   API Calls: ${apiCallsUsed} (Reddit)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      title: potdData.title,
      url: potdData.url,
      totalComments: allComments.length,
      allComments: commentData,
      apiCallsUsed,
    };
  } catch (error) {
    console.error('❌ Error getting POTD data:', error.message);
    throw error;
  }
}
