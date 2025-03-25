const dexScreenerDirect = require('./dexScreener');
const logger = require('./logger');

async function testDexScreenerDirect() {
    logger.high('Starting test for improved direct DEX API approach');

    try {
        // Test getting trending tokens
        logger.high('Testing getTrendingTokens functionality');
        const trendingTokens = await dexScreenerDirect.getTrendingTokens();
        
        if (trendingTokens.length > 0) {
            logger.high(`Successfully found ${trendingTokens.length} trending tokens`);
            logger.high('Sample trending tokens:');
            trendingTokens.slice(0, 5).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.baseToken?.symbol || 'Unknown'} - Trending Score: ${token.trendingScore?.toFixed(2) || 'N/A'}`);
                logger.deep(`DEX: ${token.dexId}, Liquidity: $${(token.liquidity?.usd || 0).toLocaleString()}`);
                logger.deep(`Volume 24h: $${(token.volume?.h24 || 0).toLocaleString()}`);
                logger.deep(`Price Change 24h: ${token.priceChange?.h24 || 0}%`);
            });
        } else {
            logger.high('No trending tokens found');
        }

        // Test getting new tokens
        logger.high('\nTesting getNewTokens functionality');
        const newTokens = await dexScreenerDirect.getNewTokens();
        
        if (newTokens.length > 0) {
            logger.high(`Successfully found ${newTokens.length} new tokens`);
            logger.high('Sample new tokens:');
            newTokens.slice(0, 5).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.baseToken?.symbol || 'Unknown'} - Created: ${new Date(token.pairCreatedAt).toLocaleString()}`);
                logger.deep(`DEX: ${token.dexId}, Liquidity: $${(token.liquidity?.usd || 0).toLocaleString()}`);
                logger.deep(`Volume 24h: $${(token.volume?.h24 || 0).toLocaleString()}`);
                logger.deep(`Price Change 24h: ${token.priceChange?.h24 || 0}%`);
            });
        } else {
            logger.high('No new tokens found');
        }

        // Test getting pairs from a specific DEX
        logger.high('\nTesting getPairsFromDex functionality');
        const dex = 'raydium'; // One of the most popular Solana DEXes
        const dexPairs = await dexScreenerDirect.getPairsFromDex(dex);
        
        if (dexPairs.length > 0) {
            logger.high(`Successfully found ${dexPairs.length} pairs on ${dex}`);
            logger.high('Sample pairs:');
            dexPairs.slice(0, 5).forEach((pair, index) => {
                logger.high(`${index + 1}. ${pair.baseToken?.symbol || 'Unknown'}/${pair.quoteToken?.symbol || 'Unknown'}`);
                logger.deep(`Liquidity: $${(pair.liquidity?.usd || 0).toLocaleString()}`);
                logger.deep(`Volume 24h: $${(pair.volume?.h24 || 0).toLocaleString()}`);
                logger.deep(`Price Change 24h: ${pair.priceChange?.h24 || 0}%`);
            });
        } else {
            logger.high(`No pairs found on ${dex}`);
        }

        // If we have tokens, test getting token pools for a sample token
        if (trendingTokens.length > 0 || newTokens.length > 0 || dexPairs.length > 0) {
            const sampleToken = (trendingTokens.length > 0) ? trendingTokens[0] : 
                               (newTokens.length > 0) ? newTokens[0] : dexPairs[0];
            
            const tokenAddress = sampleToken.baseToken?.address;
            
            if (tokenAddress) {
                logger.high(`\nTesting getTokenPools for ${sampleToken.baseToken?.symbol || 'Unknown'} (${tokenAddress})`);
                const pools = await dexScreenerDirect.getTokenPools(tokenAddress);
                
                if (pools.length > 0) {
                    logger.high(`Found ${pools.length} pools for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                    logger.high('Sample pools:');
                    pools.slice(0, 3).forEach((pool, index) => {
                        logger.high(`${index + 1}. DEX: ${pool.dexId || 'Unknown'}, Pair: ${pool.baseToken?.symbol || 'Unknown'}/${pool.quoteToken?.symbol || 'Unknown'}`);
                        logger.deep(`Liquidity: $${(pool.liquidity?.usd || 0).toLocaleString()}`);
                        logger.deep(`Volume 24h: $${(pool.volume?.h24 || 0).toLocaleString()}`);
                    });
                } else {
                    logger.high(`No pools found for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                }
            }
        }

        // Test comprehensive token discovery
        logger.high('\nTesting comprehensive token discovery using direct API approach');
        const discoveredTokens = await dexScreenerDirect.discoverTokens();
        
        if (discoveredTokens.length > 0) {
            logger.high(`Successfully discovered ${discoveredTokens.length} tokens using direct API approach`);
            logger.high('Top discovered tokens:');
            discoveredTokens.forEach((token, index) => {
                logger.high(`${index + 1}. ${token.symbol || 'Unknown'} - Score: ${token.score}`);
                logger.high(`   Reasons: ${token.reasons.join(', ')}`);
                logger.high(`   Liquidity: $${(token.liquidity || 0).toLocaleString()}`);
                logger.high(`   Volume 24h: $${(token.volume24h || 0).toLocaleString()}`);
                logger.high(`   Price Change 24h: ${token.priceChange24h || 0}%`);
                logger.high(`   Age in Hours: ${Math.floor(token.metrics.ageInHours || 0)}`);
            });
        } else {
            logger.high('No tokens discovered using direct API approach');
        }

        logger.high('\nDirect API approach test completed successfully');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testDexScreenerDirect().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});
