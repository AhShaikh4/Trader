const dexScreener = require('./dexScreener');
const logger = require('./logger');

async function testDexScreener() {
    logger.high('Starting DEX Screener integration test');

    // Test memecoin search
    const pairs = await dexScreener.searchMemecoins();
    if (pairs.length > 0) {
        logger.high(`Found ${pairs.length} potential memecoin pairs`);
        
        // Test pair details retrieval for the first pair
        const firstPair = pairs[0];
        const pairDetails = await dexScreener.getPairDetails(firstPair.pairAddress);
        
        if (pairDetails) {
            // Test token analysis
            const analysis = dexScreener.analyzeToken(pairDetails);
            logger.high(`Analysis completed for ${analysis.symbol} with score: ${analysis.score}`);
        }
    }
}

testDexScreener().catch(error => {
    logger.error(`Test failed: ${error.message}`);
});