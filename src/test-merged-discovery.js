const mergedTokenDiscovery = require('./mergedTokenDiscovery');
const logger = require('./logger');

async function testMergedTokenDiscovery() {
    console.log('Starting test for merged token discovery without search queries');

    try {
        // Test getting all pairs from popular DEXes
        console.log('Testing getAllPairsFromPopularDexes functionality');
        const allPairs = await mergedTokenDiscovery.getAllPairsFromPopularDexes();
        
        if (allPairs.length > 0) {
            console.log(`Successfully found ${allPairs.length} pairs from popular DEXes`);
            console.log('Sample pairs:');
            allPairs.slice(0, 3).forEach((pair, index) => {
                console.log(`${index + 1}. ${pair.baseToken?.symbol || 'Unknown'}/${pair.quoteToken?.symbol || 'Unknown'} on ${pair.dexId}`);
                console.log(`   Liquidity: $${(pair.liquidity?.usd || 0).toLocaleString()}`);
                console.log(`   Created: ${new Date(pair.pairCreatedAt).toLocaleString()}`);
            });
        } else {
            console.log('No pairs found from popular DEXes');
        }
        
        // Test getting recent tokens
        console.log('\nTesting getRecentTokens functionality');
        const recentTokens = await mergedTokenDiscovery.getRecentTokens();
        
        if (recentTokens.length > 0) {
            console.log(`Successfully found ${recentTokens.length} recent tokens`);
            console.log('Sample recent tokens:');
            recentTokens.slice(0, 3).forEach((token, index) => {
                console.log(`${index + 1}. ${token.baseToken?.symbol || 'Unknown'}/${token.quoteToken?.symbol || 'Unknown'} on ${token.dexId}`);
                console.log(`   Age: ${mergedTokenDiscovery.getAgeInHours(token.pairCreatedAt).toFixed(2)} hours`);
                console.log(`   Liquidity: $${(token.liquidity?.usd || 0).toLocaleString()}`);
                console.log(`   Volume 24h: $${(token.volume?.h24 || 0).toLocaleString()}`);
            });
        } else {
            console.log('No recent tokens found');
        }
        
        // Test applying age-based criteria
        if (recentTokens.length > 0) {
            console.log('\nTesting applyAgeBuyingCriteria functionality');
            const decisions = mergedTokenDiscovery.applyAgeBuyingCriteria(recentTokens);
            
            console.log(`Applied criteria to ${decisions.all.length} tokens`);
            console.log(`Found ${decisions.buy.length} tokens meeting buying criteria`);
            
            if (decisions.buy.length > 0) {
                console.log('Sample buy decisions:');
                decisions.buy.slice(0, 3).forEach((decision, index) => {
                    console.log(`${index + 1}. ${decision.token.baseToken?.symbol || 'Unknown'} - ${decision.appliedCriteria}`);
                    console.log(`   Age: ${decision.ageHours.toFixed(2)} hours`);
                    if (decision.isVeryRecent) {
                        console.log(`   5m Change: ${decision.metrics.priceChangeM5}%, 5m Volume: $${decision.metrics.volumeM5}`);
                    } else {
                        console.log(`   1h Change: ${decision.metrics.priceChangeH1}%, 1h Volume: $${decision.metrics.volumeH1}`);
                    }
                    console.log(`   Liquidity: $${decision.metrics.liquidity}`);
                });
            }
        }
        
        // Test comprehensive token discovery
        console.log('\nTesting comprehensive token discovery without search queries');
        const discoveredTokens = await mergedTokenDiscovery.discoverTokens();
        
        if (discoveredTokens.length > 0) {
            console.log(`Successfully discovered ${discoveredTokens.length} tokens without using search queries`);
            console.log('Top discovered tokens:');
            discoveredTokens.slice(0, 3).forEach((token, index) => {
                console.log(`${index + 1}. ${token.symbol || 'Unknown'} - Score: ${token.score.toFixed(2)}`);
                console.log(`   Reasons: ${token.reasons.join(', ')}`);
                console.log(`   Liquidity: $${(token.liquidity || 0).toLocaleString()}`);
                console.log(`   Volume 24h: $${(token.volume24h || 0).toLocaleString()}`);
                console.log(`   Price Change 24h: ${token.priceChange24h || 0}%`);
                console.log(`   Age in Hours: ${token.metrics.ageInHours.toFixed(2)}`);
                
                if (token.moralisData) {
                    console.log(`   Enhanced with Moralis data: Yes`);
                    if (token.moralisData.metadata) {
                        console.log(`   Metadata: Name=${token.moralisData.metadata.name}, Symbol=${token.moralisData.metadata.symbol}`);
                    }
                    if (token.moralisData.price) {
                        console.log(`   Moralis Price: $${token.moralisData.price.usdPrice}`);
                    }
                } else {
                    console.log(`   Enhanced with Moralis data: No`);
                }
            });
        } else {
            console.log('No tokens discovered without search queries');
        }
        
        console.log('\nMerged token discovery test completed successfully');
    } catch (error) {
        console.error(`Test failed: ${error.message}`);
        console.error(error.stack);
        throw error;
    }
}

// Run the test
testMergedTokenDiscovery().catch(error => {
    console.error(`Fatal error in test suite: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});
