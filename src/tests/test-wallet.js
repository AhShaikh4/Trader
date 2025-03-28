const wallet = require('../wallet');
const logger = require('../logger');

// Test Wallet module functionality
async function testWallet() {
  try {
    logger.high('Testing Wallet module...');
    
    // Test wallet initialization
    logger.high('Initializing wallet...');
    const initialized = wallet.initialize();
    
    if (initialized) {
      logger.high('Wallet initialized successfully');
      
      // Test getting wallet balance
      logger.high('Getting wallet balance...');
      const balance = await wallet.getBalance();
      
      if (balance !== null) {
        logger.high(`Current wallet balance: ${balance} SOL`);
      } else {
        logger.error('Failed to get wallet balance');
      }
    } else {
      logger.error('Failed to initialize wallet');
    }
    
    logger.high('Wallet module tests completed');
    return initialized;
  } catch (error) {
    logger.error(`Wallet module tests failed: ${error.message}`);
    return false;
  }
}

// Run the tests
testWallet()
  .then(success => {
    if (success) {
      logger.high('All Wallet tests passed');
    } else {
      logger.error('Some Wallet tests failed');
    }
  })
  .catch(error => {
    logger.error(`Error running Wallet tests: ${error.message}`);
  });
