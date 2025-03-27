const dexScreenerDirect = require('./dexScreener');
const logger = require('./logger');

async function testMoralisEnhancement() {
    logger.high('Starting test for Moralis token info enhancement');

    try {
        // Test getting trending tokens
        logger.high('Testing getTrendingTokens functionality');
        const trendingTokens = await dexScreenerDirect.getTrendingTokens();
        
        if (trendingTokens.length > 0) {
            // Get the first token for testing enhanced info
            const sampleToken = trendingTokens[0];
            const tokenAddress = sampleToken.baseToken?.address;
            
            if (tokenAddress) {
                // Test getTokenInfo method
                logger.high(`\nTesting getTokenInfo for ${sampleToken.baseToken?.symbol || 'Unknown'} (${tokenAddress})`);
                const tokenInfo = await dexScreenerDirect.getTokenInfo(tokenAddress);
                
                if (tokenInfo) {
                    logger.high(`Successfully retrieved enhanced token info from Moralis`);
                    logger.high('Token Metadata:');
                    if (tokenInfo.metadata) {
                        logger.high(`Name: ${tokenInfo.metadata.name || 'N/A'}`);
                        logger.high(`Symbol: ${tokenInfo.metadata.symbol || 'N/A'}`);
                        logger.high(`Decimals: ${tokenInfo.metadata.decimals || 'N/A'}`);
                        if (tokenInfo.metadata.links) {
                            logger.high(`Links: ${Object.keys(tokenInfo.metadata.links).join(', ')}`);
                        }
                    } else {
                        logger.high('No metadata available');
                    }
                    
                    logger.high('\nToken Price:');
                    if (tokenInfo.price) {
                        logger.high(`USD Price: $${tokenInfo.price.usdPrice || 'N/A'}`);
                        logger.high(`24h Change: ${tokenInfo.price.usdPrice24hrPercentChange || 'N/A'}%`);
                        logger.high(`Exchange: ${tokenInfo.price.exchangeName || 'N/A'}`);
                    } else {
                        logger.high('No price information available');
                    }
                } else {
                    logger.high(`No enhanced token info found for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                }
                
                // Test enhanceTokenData method
                logger.high(`\nTesting enhanceTokenData for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                const enhancedToken = await dexScreenerDirect.enhanceTokenData(sampleToken);
                
                if (enhancedToken.moralisData) {
                    logger.high(`Successfully enhanced token data with Moralis information`);
                } else {
                    logger.high(`No Moralis data added to token`);
                }
                
                // Test getEnhancedTokenPools method
                logger.high(`\nTesting getEnhancedTokenPools for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                const enhancedPools = await dexScreenerDirect.getEnhancedTokenPools(tokenAddress);
                
                if (enhancedPools.length > 0) {
                    logger.high(`Successfully retrieved ${enhancedPools.length} enhanced pools`);
                    logger.high('Sample enhanced pool:');
                    const samplePool = enhancedPools[0];
                    logger.high(`DEX: ${samplePool.dexId || 'Unknown'}`);
                    logger.high(`Pair: ${samplePool.baseToken?.symbol || 'Unknown'}/${samplePool.quoteToken?.symbol || 'Unknown'}`);
                    if (samplePool.moralisData) {
                        logger.high(`Enhanced with Moralis data: Yes`);
                    } else {
                        logger.high(`Enhanced with Moralis data: No`);
                    }
                } else {
                    logger.high(`No enhanced pools found for ${sampleToken.baseToken?.symbol || 'Unknown'}`);
                }
            }
        } else {
            logger.high('No trending tokens found for testing');
        }
        
        // Test comprehensive token discovery with Moralis enhancement
        logger.high('\nTesting comprehensive token discovery with Moralis enhancement');
        const discoveredTokens = await dexScreenerDirect.discoverTokens();
        
        if (discoveredTokens.length > 0) {
            logger.high(`Successfully discovered ${discoveredTokens.length} tokens with Moralis enhancement`);
            logger.high('Top discovered tokens:');
            discoveredTokens.slice(0, 3).forEach((token, index) => {
                logger.high(`${index + 1}. ${token.symbol || 'Unknown'} - Score: ${token.score}`);
                logger.high(`   Reasons: ${token.reasons.join(', ')}`);
                logger.high(`   Liquidity: $${(token.liquidity || 0).toLocaleString()}`);
                logger.high(`   Volume 24h: $${(token.volume24h || 0).toLocaleString()}`);
                logger.high(`   Price Change 24h: ${token.priceChange24h || 0}%`);
                
                if (token.moralisData) {
                    logger.high(`   Enhanced with Moralis data: Yes`);
                    if (token.moralisData.metadata) {
                        logger.high(`   Metadata: Name=${token.moralisData.metadata.name}, Symbol=${token.moralisData.metadata.symbol}`);
                    }
                    if (token.moralisData.price) {
                        logger.high(`   Moralis Price: $${token.moralisData.price.usdPrice}`);
                    }
                } else {
                    logger.high(`   Enhanced with Moralis data: No`);
                }
            });
        } else {
            logger.high('No tokens discovered for testing');
        }
        
        logger.high('\nMoralis token info enhancement test completed successfully');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testMoralisEnhancement().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});
