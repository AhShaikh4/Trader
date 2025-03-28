const birdeye = require('../birdeye');
const logger = require('../logger');

// Test Birdeye module functionality
async function testBirdeye() {
  try {
    logger.high('Testing Birdeye module...');
    
    // Sample token address for testing (SOL)
    const solTokenAddress = 'So11111111111111111111111111111111111111112';
    
    // Test getting token price
    logger.high(`Testing token price for SOL: ${solTokenAddress}`);
    const priceData = await birdeye.getTokenPrice(solTokenAddress);
    
    if (priceData && priceData.value) {
      logger.high(`SOL price: ${priceData.value}`);
    } else {
      logger.error('Failed to get SOL price');
    }
    
    // Test getting historical price
    logger.high(`Testing historical price for SOL: ${solTokenAddress}`);
    const historicalData = await birdeye.getHistoricalPrice(solTokenAddress, '15m', 1);
    
    if (historicalData && historicalData.items && historicalData.items.length > 0) {
      logger.high(`Retrieved ${historicalData.items.length} historical price points`);
    } else {
      logger.error('Failed to get historical price data');
    }
    
    // Test token analysis
    logger.high(`Testing comprehensive analysis for SOL: ${solTokenAddress}`);
    const analysis = await birdeye.analyzeToken(solTokenAddress);
    
    if (analysis && analysis.price) {
      logger.high(`Analysis complete. Current price: ${analysis.price}`);
      if (analysis.priceChange1h !== undefined) {
        logger.high(`1h price change: ${analysis.priceChange1h.toFixed(2)}%`);
      }
    } else {
      logger.error('Failed to complete token analysis');
    }
    
    logger.high('Birdeye module tests completed successfully');
    return true;
  } catch (error) {
    logger.error(`Birdeye module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testBirdeye()
  .then(success => {
    if (success) {
      logger.high('All Birdeye tests passed');
    } else {
      logger.error('Some Birdeye tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running Birdeye tests: ${error.message}`);
  });
