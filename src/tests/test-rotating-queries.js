const dexscreener = require('../dexscreener');

async function testRotatingQueryApproach() {
  console.log('Testing rotating query approach...');
  
  // Make multiple calls to see different query sets being used
  const callCount = 3;
  const querySets = [];
  
  for (let i = 0; i < callCount; i++) {
    console.log(`\nCall #${i+1} to getTrendingTokens:`);
    const tokens = await dexscreener.getTrendingTokens();
    console.log(`Retrieved ${tokens.length} tokens`);
    
    // Store the query set used for this call
    // Note: We can't directly access the query set, but we can see it in the logs
    
    // Also test high volume tokens
    console.log(`\nCall #${i+1} to getHighVolumeTokens:`);
    const volumeTokens = await dexscreener.getHighVolumeTokens();
    console.log(`Retrieved ${volumeTokens.length} high volume tokens`);
    
    // And test recent tokens
    console.log(`\nCall #${i+1} to getRecentTokens:`);
    const recentTokens = await dexscreener.getRecentTokens();
    console.log(`Retrieved ${recentTokens.length} recent tokens`);
  }
  
  console.log('\nRotating query test complete. Check logs to verify different query sets were used for each call.');
}

testRotatingQueryApproach().catch(console.error);
