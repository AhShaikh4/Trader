const dexscreener = require('../dexscreener');

async function testTokenDiversityTracking() {
  console.log('Testing token diversity tracking...');
  
  // First call should return a set of tokens
  console.log('\nFirst call to getTrendingTokens:');
  const firstBatch = await dexscreener.getTrendingTokens();
  console.log(`Retrieved ${firstBatch.length} tokens in first batch`);
  
  if (firstBatch.length > 0) {
    console.log('Sample tokens from first batch:');
    firstBatch.slice(0, 3).forEach((pair, i) => {
      console.log(`${i+1}. ${pair.baseToken?.symbol || 'Unknown'} (${pair.baseToken?.address || 'No address'})`);
    });
  }
  
  // Store addresses from first batch
  const firstBatchAddresses = new Set(
    firstBatch
      .filter(pair => pair.baseToken?.address)
      .map(pair => pair.baseToken.address)
  );
  
  console.log(`\nStored ${firstBatchAddresses.size} unique addresses from first batch`);
  
  // Second call should return different tokens due to diversity tracking
  console.log('\nSecond call to getTrendingTokens:');
  const secondBatch = await dexscreener.getTrendingTokens();
  console.log(`Retrieved ${secondBatch.length} tokens in second batch`);
  
  if (secondBatch.length > 0) {
    console.log('Sample tokens from second batch:');
    secondBatch.slice(0, 3).forEach((pair, i) => {
      console.log(`${i+1}. ${pair.baseToken?.symbol || 'Unknown'} (${pair.baseToken?.address || 'No address'})`);
    });
  }
  
  // Count how many tokens from second batch were not in first batch
  const newTokensCount = secondBatch.filter(pair => 
    pair.baseToken?.address && !firstBatchAddresses.has(pair.baseToken.address)
  ).length;
  
  const diversityPercentage = secondBatch.length > 0 
    ? (newTokensCount / secondBatch.length * 100).toFixed(1) 
    : 0;
  
  console.log(`\nDiversity analysis: ${newTokensCount} out of ${secondBatch.length} tokens in second batch are new (${diversityPercentage}%)`);
  
  if (diversityPercentage > 50) {
    console.log('✅ Token diversity tracking is working well (>50% new tokens)');
  } else if (diversityPercentage > 0) {
    console.log('⚠️ Token diversity tracking is working but with limited effectiveness');
  } else {
    console.log('❌ Token diversity tracking does not appear to be working');
  }
}

testTokenDiversityTracking().catch(console.error);
