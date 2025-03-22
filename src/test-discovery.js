const tokenDiscovery = require('./tokenDiscovery');
const logger = require('./logger');

async function testTokenDiscovery() {
    logger.high('Starting token discovery system test');

    try {
        // Test initial scan with forceFresh=true
        logger.high('Running fresh token scan...');
        const opportunities = await tokenDiscovery.findTradingOpportunities(true);

        if (opportunities.length > 0) {
            logger.high(`Found ${opportunities.length} trading opportunities`);
            
            // Display top 3 opportunities
            opportunities.slice(0, 3).forEach((opp, index) => {
                logger.high(`\nOpportunity #${index + 1}: ${opp.symbol}`);
                logger.high(`Combined Score: ${opp.combinedScore}`);
                logger.high(`Price: $${opp.price}`);
                logger.high(`Liquidity: $${opp.liquidity.toLocaleString()}`);
                logger.high(`1h Price Change: ${opp.priceChange1h?.toFixed(2)}%`);
                logger.high(`24h Price Change: ${opp.priceChange24h?.toFixed(2)}%`);
                logger.high(`Price Consistency: ${(opp.metrics.priceConsistency * 100).toFixed(2)}%`);
                logger.high('Reasons for selection:');
                opp.reasons.forEach(reason => logger.high(`- ${reason}`));
            });

            // Test cache with shorter interval
            logger.high('\nTesting cache behavior...');
            logger.high('Waiting 15 seconds before second scan...');
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            const cachedOpportunities = await tokenDiscovery.findTradingOpportunities();
            logger.high(`Retrieved ${cachedOpportunities.length} opportunities from cache`);
            
            logger.high('Waiting 45 seconds for cache to expire...');
            await new Promise(resolve => setTimeout(resolve, 45000));
            
            const freshOpportunities = await tokenDiscovery.findTradingOpportunities();
            logger.high(`Retrieved ${freshOpportunities.length} opportunities from fresh scan`);
        } else {
            logger.high('No viable trading opportunities found');
        }

    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testTokenDiscovery().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});
