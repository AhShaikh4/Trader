const moralis = require('../moralis');
const logger = require('../logger');

// Test Moralis module functionality
async function testMoralis() {
  try {
    logger.high('Testing Moralis module...');
    
    // Initialize Moralis
    logger.high('Initializing Moralis...');
    await moralis.initMoralis();
    logger.high('Moralis initialized successfully');
    
    // Sample token address for testing (SOL)
    const solTokenAddress = 'So11111111111111111111111111111111111111112';
    
    // Test getting token metadata
    logger.high(`Testing token metadata for SOL: ${solTokenAddress}`);
    const metadata = await moralis.getTokenMetadata('mainnet', solTokenAddress);
    
    if (metadata) {
      logger.high(`Retrieved metadata for ${metadata.symbol || 'token'}`);
      logger.deep(`Token name: ${metadata.name || 'N/A'}`);
      logger.deep(`Token symbol: ${metadata.symbol || 'N/A'}`);
      logger.deep(`Token decimals: ${metadata.decimals || 'N/A'}`);
    } else {
      logger.error('Failed to get token metadata');
    }
    
    // Test getting token price
    logger.high(`Testing token price for SOL: ${solTokenAddress}`);
    const priceData = await moralis.getTokenPrice('mainnet', solTokenAddress);
    
    if (priceData) {
      logger.high(`SOL price: $${priceData.usdPrice}`);
    } else {
      logger.error('Failed to get token price');
    }
    
    logger.high('Moralis module tests completed successfully');
    return true;
  } catch (error) {
    logger.error(`Moralis module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testMoralis()
  .then(success => {
    if (success) {
      logger.high('All Moralis tests passed');
    } else {
      logger.error('Some Moralis tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running Moralis tests: ${error.message}`);
  });
