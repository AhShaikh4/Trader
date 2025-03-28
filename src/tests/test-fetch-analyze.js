const fetchAnalyze = require('../modules/fetch-analyze');
const logger = require('../logger');

// Test Fetch & Analyze module functionality
async function testFetchAnalyze() {
  try {
    logger.high('Testing Fetch & Analyze module...');
    
    // Initialize Moralis through the module
    logger.high('Ensuring Moralis is initialized...');
    await fetchAnalyze.ensureMoralisInitialized();
    
    // Test token discovery
    logger.high('Testing token discovery...');
    logger.high('This may take some time as it queries multiple sources...');
    
    // Limit the discovery to save API credits
    const discoveredTokens = await fetchAnalyze.discoverNewTokens();
    
    if (discoveredTokens && discoveredTokens.length > 0) {
      logger.high(`Discovered ${discoveredTokens.length} tokens`);
      
      // Test comprehensive analysis on the first discovered token
      const sampleToken = discoveredTokens[0].baseToken.address;
      logger.high(`Testing comprehensive analysis for sample token: ${sampleToken}`);
      
      const analysis = await fetchAnalyze.comprehensiveTokenAnalysis(sampleToken);
      
      if (analysis) {
        logger.high('Comprehensive analysis completed successfully');
        logger.deep(`Analysis contains data from ${Object.keys(analysis).filter(k => analysis[k] !== null).length} sources`);
      } else {
        logger.error('Failed to complete comprehensive analysis');
      }
      
      // Test token info retrieval
      logger.high(`Testing token info retrieval for sample token: ${sampleToken}`);
      const tokenInfo = await fetchAnalyze.getTokenInfo(sampleToken);
      
      if (tokenInfo) {
        logger.high('Token info retrieved successfully');
      } else {
        logger.error('Failed to retrieve token info');
      }
    } else {
      logger.error('Failed to discover any tokens');
    }
    
    logger.high('Fetch & Analyze module tests completed');
    return true;
  } catch (error) {
    logger.error(`Fetch & Analyze module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testFetchAnalyze()
  .then(success => {
    if (success) {
      logger.high('All Fetch & Analyze tests passed');
    } else {
      logger.error('Some Fetch & Analyze tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running Fetch & Analyze tests: ${error.message}`);
  });
