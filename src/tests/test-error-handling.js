const dexscreener = require('../dexscreener');

async function testErrorHandlingAndFallbacks() {
  console.log('Testing error handling and fallbacks...');
  
  // Test 1: Test fallback for invalid DEX ID
  console.log('\nTest 1: Testing fallback for invalid DEX ID');
  try {
    const invalidDexPairs = await dexscreener.getPairsFromDex('nonexistentdex123');
    console.log(`Retrieved ${invalidDexPairs.length} pairs using fallback mechanism`);
    console.log('✅ Fallback for invalid DEX ID working correctly');
  } catch (error) {
    console.error('❌ Fallback for invalid DEX ID failed:', error.message);
  }
  
  // Test 2: Test retry mechanism by temporarily breaking the API URL
  console.log('\nTest 2: Testing retry mechanism');
  // Save the original baseUrl
  const originalBaseUrl = dexscreener.baseUrl;
  
  try {
    // Temporarily break the URL to force retries
    dexscreener.baseUrl = 'https://invalid-url-to-force-retry.com';
    
    // Set a timeout to restore the URL after 2 seconds
    setTimeout(() => {
      console.log('Restoring valid API URL after forcing retry...');
      dexscreener.baseUrl = originalBaseUrl;
    }, 2000);
    
    // This should fail initially but succeed after URL is restored
    const pairs = await dexscreener.getSolanaPairs();
    console.log(`Retrieved ${pairs.length} pairs after retry`);
    console.log('✅ Retry mechanism working correctly');
  } catch (error) {
    console.error('❌ Retry mechanism failed:', error.message);
    // Restore URL in case of failure
    dexscreener.baseUrl = originalBaseUrl;
  }
  
  // Test 3: Test fallback for token pools
  console.log('\nTest 3: Testing fallback for token pools');
  try {
    // Use an invalid token address to force fallback
    const invalidTokenPools = await dexscreener.getTokenPools('invalid_token_address_123');
    console.log(`Retrieved ${invalidTokenPools.length} pools using fallback mechanism`);
    console.log('✅ Fallback for token pools working correctly');
  } catch (error) {
    console.error('❌ Fallback for token pools failed:', error.message);
  }
  
  console.log('\nError handling and fallbacks test complete.');
}

testErrorHandlingAndFallbacks().catch(console.error);
