const bitqueryApi = require('./bitqueryApi');
const logger = require('./logger');

async function testBitqueryIntegration() {
    logger.high('Starting Bitquery API integration test');

    try {
        // Test token discovery
        logger.high('Testing token discovery subscription...');
        const discoverySubscription = await bitqueryApi.startTokenDiscovery(async (token) => {
            logger.high(`New token discovered: ${token.Symbol}`);
            
            // Test liquidity check
            const liquidityInfo = await bitqueryApi.checkLiquidityPool(token.MintAddress);
            logger.high(`Liquidity check for ${token.Symbol}:`, {
                hasLiquidity: liquidityInfo.hasLiquidity,
                amount: `$${liquidityInfo.liquidity.toLocaleString()}`,
                exchanges: liquidityInfo.exchanges.join(', ')
            });

            if (liquidityInfo.hasLiquidity) {
                // Test trade analysis
                logger.high(`Starting trade analysis for ${token.Symbol}`);
                bitqueryApi.startTradeAnalysis(token.MintAddress, (metrics) => {
                    logger.high(`Trade metrics for ${token.Symbol}:`, {
                        buySellRatio: metrics.buySellRatio.toFixed(2),
                        uniqueBuyers: metrics.uniqueBuyerCount,
                        uniqueSellers: metrics.uniqueSellerCount,
                        totalVolume: `$${metrics.totalVolume.toLocaleString()}`,
                        currentPrice: `$${metrics.currentPrice}`
                    });
                });

                // Test holder distribution analysis
                const holders = await bitqueryApi.getHolderDistribution(token.MintAddress);
                logger.high(`Top holders for ${token.Symbol}:`, holders);

                // Stop analysis after 5 minutes
                setTimeout(() => {
                    bitqueryApi.stopTradeAnalysis(token.MintAddress);
                    logger.high(`Stopped monitoring ${token.Symbol}`);
                }, 5 * 60 * 1000);
            }
        });

        // Run test for 10 minutes
        logger.high('Test running... Will stop in 10 minutes');
        await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));

        // Cleanup
        discoverySubscription.unsubscribe();
        bitqueryApi.cleanup();
        logger.high('Test completed successfully');

    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        bitqueryApi.cleanup();
    }
}

// Run the test
testBitqueryIntegration().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});