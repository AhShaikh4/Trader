const dexscreener = require('../dexscreener');
const logger = require('../logger');

// Test DexScreener module functionality
async function testDexScreener() {
  try {
    logger.high('Testing DexScreener module...');
    
    // Test getting popular DEXes
    const popularDexes = await dexscreener.getPopularDexes();
    logger.high(`Found ${popularDexes.length} popular DEXes`);
    
    // Test getting trending tokens
    const trendingTokens = await dexscreener.getTrendingTokens();
    logger.high(`Found ${trendingTokens.length} trending tokens`);
    
    // Test getting token pools for a sample token (if trending tokens were found)
    if (trendingTokens.length > 0) {
      const sampleToken = trendingTokens[0].baseToken.address;
      logger.high(`Testing token pools for sample token: ${sampleToken}`);
      
      const tokenPools = await dexscreener.getTokenPools(sampleToken);
      logger.high(`Found ${tokenPools.length} pools for token ${sampleToken}`);
    }
    
    logger.high('DexScreener module tests completed successfully');
    return true;
  } catch (error) {
    logger.error(`DexScreener module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testDexScreener()
  .then(success => {
    if (success) {
      logger.high('All DexScreener tests passed');
    } else {
      logger.error('Some DexScreener tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running DexScreener tests: ${error.message}`);
  });
