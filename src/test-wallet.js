const wallet = require('./wallet');
const logger = require('./logger');

async function testWallet() {
    logger.high('Starting wallet connection test');
    
    // Test initialization
    const initialized = wallet.initialize();
    if (!initialized) {
        logger.error('Failed to initialize wallet');
        return;
    }
    
    // Test balance retrieval
    const balance = await wallet.getBalance();
    if (balance !== null) {
        logger.high(`Successfully retrieved balance: ${balance} SOL`);
    }
}

testWallet().catch(error => {
    logger.error(`Test failed: ${error.message}`);
});