const traderAPI = require('./traderAPI');
const logger = require('./logger');

async function testConsolidatedAPI() {
    logger.high('Starting consolidated API test');

    try {
        // Test DexScreener functionality
        logger.high('\nTesting DexScreener functionality');
        
        // Test getting popular DEXes
        const popularDexes = await traderAPI.getPopularDexes();
        logger.high(`Found ${popularDexes.length} popular DEXes`);
        
        // Test getting token pools
        if (popularDexes.length > 0) {
            // We'll use a known token for testing
            const knownToken = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
            logger.high(`Testing getTokenPools for ${knownToken}`);
            
            const pools = await traderAPI.getTokenPools(knownToken);
            logger.high(`Found ${pools.length} pools for token`);
            
            if (pools.length > 0) {
                logger.high('Sample pool data:');
                logger.high(`DEX: ${pools[0].dexId}`);
                logger.high(`Pair: ${pools[0].baseToken?.symbol}/${pools[0].quoteToken?.symbol}`);
                logger.high(`Liquidity: $${pools[0].liquidity?.usd || 'N/A'}`);
            }
        }
        
        // Test Moralis functionality
        logger.high('\nTesting Moralis functionality');
        
        // Test getting token info
        const knownToken = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
        logger.high(`Testing getTokenInfo for ${knownToken}`);
        
        const tokenInfo = await traderAPI.getTokenInfo(knownToken);
        if (tokenInfo) {
            logger.high('Successfully retrieved token info from Moralis');
            if (tokenInfo.metadata) {
                logger.high(`Token name: ${tokenInfo.metadata.name}`);
                logger.high(`Token symbol: ${tokenInfo.metadata.symbol}`);
            }
            if (tokenInfo.price) {
                logger.high(`Token price: $${tokenInfo.price.usdPrice}`);
            }
        } else {
            logger.high('Could not retrieve token info from Moralis');
        }
        
        // Test token discovery functionality
        logger.high('\nTesting token discovery functionality');
        
        // Test getting recent tokens
        const recentTokens = await traderAPI.getRecentTokens();
        logger.high(`Found ${recentTokens.length} recent tokens`);
        
        // Test discovering tokens
        const discoveredTokens = await traderAPI.discoverTokens();
        logger.high(`Discovered ${discoveredTokens.length} tokens`);
        
        if (discoveredTokens.length > 0) {
            logger.high('Top discovered tokens:');
            discoveredTokens.slice(0, 3).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.symbol || 'Unknown'} - Score: ${token.score.toFixed(2)}`);
                logger.high(`   Reasons: ${token.reasons.join(', ')}`);
            });
        }
        
        logger.high('\nConsolidated API test completed successfully');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        logger.error(error.stack);
        throw error;
    }
}

// Run the test
testConsolidatedAPI().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
});
