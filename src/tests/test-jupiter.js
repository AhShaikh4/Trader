const jupiter = require('../jupiter');
const logger = require('../logger');

// Test Jupiter module functionality
async function testJupiter() {
  try {
    logger.high('Testing Jupiter module...');
    
    // Sample token addresses for testing
    const solTokenAddress = 'So11111111111111111111111111111111111111112';
    const usdcTokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const testAmount = '1000000'; // 1 USDC (6 decimals)
    
    // Test getting quote
    logger.high(`Testing quote for USDC to SOL swap`);
    const quote = await jupiter.getQuote(usdcTokenAddress, solTokenAddress, testAmount);
    
    if (quote) {
      logger.high(`Quote received. Out amount: ${quote.outAmount}`);
      
      // Test price impact calculation
      const priceImpact = jupiter.calculatePriceImpact(quote);
      if (priceImpact !== null) {
        logger.high(`Price impact: ${priceImpact.toFixed(2)}%`);
      } else {
        logger.error('Failed to calculate price impact');
      }
      
      // Test finding best route
      logger.high('Testing findBestRoute...');
      const bestRoute = await jupiter.findBestRoute(usdcTokenAddress, solTokenAddress, testAmount);
      
      if (bestRoute) {
        logger.high(`Best route found. Out amount: ${bestRoute.outAmount}`);
        logger.high(`Route has ${bestRoute.routeMap.length} hops`);
      } else {
        logger.error('Failed to find best route');
      }
    } else {
      logger.error('Failed to get quote');
    }
    
    logger.high('Jupiter module tests completed successfully');
    return true;
  } catch (error) {
    logger.error(`Jupiter module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testJupiter()
  .then(success => {
    if (success) {
      logger.high('All Jupiter tests passed');
    } else {
      logger.error('Some Jupiter tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running Jupiter tests: ${error.message}`);
  });
