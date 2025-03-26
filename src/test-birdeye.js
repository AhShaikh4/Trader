const birdeyeApi = require('./birdeyeApi');
const dexScreener = require('./dexScreener');
const logger = require('./logger');

async function testBirdeyeApi() {
    logger.high('Starting Birdeye API integration test with multiple tokens');

    try {
        // Get test tokens from DexScreener using getTrendingTokens instead of searchMemecoins
        const pairs = await dexScreener.getTrendingTokens();
        if (pairs.length === 0) {
            throw new Error('No tokens found via DexScreener to test with');
        }

        // Test with first 3 tokens or all if less than 3
        const testTokens = pairs.slice(0, 3).map(pair => ({
            symbol: pair.baseToken.symbol,
            address: pair.baseToken.address
        }));
        logger.high(`Found ${testTokens.length} tokens to test with`);

        for (const token of testTokens) {
            logger.high(`\nTesting token: ${token.symbol} (${token.address})`);

            // Test basic price data
            logger.high('Fetching price data...');
            const priceData = await birdeyeApi.getTokenPrice(token.address);
            if (priceData) {
                logger.high('Price data retrieved:');
                logger.high(`- Price: $${priceData.value}`);
                logger.high(`- Last Update: ${priceData.updateHumanTime}`);
                if (priceData.liquidity) {
                    logger.high(`- Liquidity: $${priceData.liquidity}`);
                }
            }

            // Test full analysis
            logger.high('Running full token analysis...');
            const analysis = await birdeyeApi.analyzeToken(token.address);
            if (analysis) {
                logger.high('Analysis completed:');
                logger.high(`- Price: $${analysis.price}`);
                logger.high(`- Last Update: ${analysis.updateTime}`);
                if (analysis.priceChange1h !== undefined) {
                    logger.high(`- 1h Price Change: ${analysis.priceChange1h.toFixed(2)}%`);
                }
            }

            // Add delay between tokens to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

    } catch (error) {
        logger.error(`Test suite failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testBirdeyeApi().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});
