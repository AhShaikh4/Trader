const dexScreener = require('./dexScreener');
const logger = require('./logger');

async function testDexScreener() {
    logger.high('Starting comprehensive DEX Screener test suite');

    // Test top memecoin search
    logger.high('Testing findTopMemecoins functionality');
    const topTokens = await dexScreener.findTopMemecoins();
    
    if (topTokens.length > 0) {
        logger.high(`Successfully found ${topTokens.length} top memecoin opportunities`);
        logger.high('Top token details:');
        topTokens.forEach((token, index) => {
            logger.high(`${index + 1}. ${token.symbol} - Score: ${token.score}`);
            logger.deep(`Reasons: ${token.reasons.join(', ')}`);
            logger.deep(`Liquidity: $${token.liquidity.toLocaleString()}`);
            logger.deep(`24h Volume: $${token.volume24h.toLocaleString()}`);
            logger.deep(`24h Price Change: ${token.priceChange24h}%`);
        });
    } else {
        logger.high('No tokens found matching criteria');
    }
}

// Run tests
testDexScreener().catch(error => {
    logger.error(`Test suite failed: ${error.message}`);
    process.exit(1);
});