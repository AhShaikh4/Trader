const mergedTokenDiscovery = require('./mergedTokenDiscovery');
const logger = require('./logger');

async function testConsolidatedDiscovery() {
    logger.high('Starting consolidated token discovery system test');

    try {
        // Test getting all pairs from popular DEXes
        logger.high('Testing getAllPairsFromPopularDexes functionality');
        const allPairs = await mergedTokenDiscovery.getAllPairsFromPopularDexes();
        
        if (allPairs.length > 0) {
            logger.high(`Successfully found ${allPairs.length} pairs from popular DEXes`);
            logger.high('Sample pairs:');
            allPairs.slice(0, 3).forEach((pair, index) => {
                logger.high(`${index + 1}. ${pair.baseToken?.symbol || 'Unknown'}/${pair.quoteToken?.symbol || 'Unknown'} on ${pair.dexId}`);
                logger.high(`   Liquidity: $${(pair.liquidity?.usd || 0).toLocaleString()}`);
                logger.high(`   Created: ${new Date(pair.pairCreatedAt).toLocaleString()}`);
            });
        } else {
            logger.high('No pairs found from popular DEXes');
        }
        
        // Test getting recent tokens
        logger.high('\nTesting getRecentTokens functionality');
        const recentTokens = await mergedTokenDiscovery.getRecentTokens();
        
        if (recentTokens.length > 0) {
            logger.high(`Successfully found ${recentTokens.length} recent tokens`);
            logger.high('Sample recent tokens:');
            recentTokens.slice(0, 3).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.baseToken?.symbol || 'Unknown'}/${token.quoteToken?.symbol || 'Unknown'} on ${token.dexId}`);
                logger.high(`   Age: ${mergedTokenDiscovery.getAgeInHours(token.pairCreatedAt).toFixed(2)} hours`);
                logger.high(`   Liquidity: $${(token.liquidity?.usd || 0).toLocaleString()}`);
                logger.high(`   Volume 24h: $${(token.volume?.h24 || 0).toLocaleString()}`);
            });
        } else {
            logger.high('No recent tokens found');
        }
        
        // Test comprehensive token discovery
        logger.high('\nTesting comprehensive token discovery');
        const discoveredTokens = await mergedTokenDiscovery.discoverTokens();
        
        if (discoveredTokens.length > 0) {
            logger.high(`Successfully discovered ${discoveredTokens.length} tokens`);
            logger.high('Top discovered tokens:');
            discoveredTokens.slice(0, 3).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.symbol || 'Unknown'} - Score: ${token.score.toFixed(2)}`);
                logger.high(`   Reasons: ${token.reasons.join(', ')}`);
                logger.high(`   Liquidity: $${(token.liquidity || 0).toLocaleString()}`);
                logger.high(`   Volume 24h: $${(token.volume24h || 0).toLocaleString()}`);
                logger.high(`   Price Change 24h: ${token.priceChange24h || 0}%`);
                logger.high(`   Age in Hours: ${token.metrics.ageInHours.toFixed(2)}`);
                
                if (token.moralisData) {
                    logger.high(`   Enhanced with Moralis data: Yes`);
                } else {
                    logger.high(`   Enhanced with Moralis data: No`);
                }
            });
            
            // Test cache behavior
            logger.high('\nTesting cache behavior...');
            logger.high('Running second discovery to test cache...');
            
            const cachedTokens = await mergedTokenDiscovery.discoverTokens();
            logger.high(`Retrieved ${cachedTokens.length} tokens from cache or fresh scan`);
        } else {
            logger.high('No tokens discovered');
        }
        
        logger.high('\nConsolidated token discovery test completed successfully');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        logger.error(error.stack);
        throw error;
    }
}

// Run the test
testConsolidatedDiscovery().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
});
