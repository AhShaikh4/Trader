const jupiterApi = require('./jupiterApi');
const dexScreener = require('./dexScreener');
const { PublicKey } = require('@solana/web3.js');
const logger = require('./logger');

// USDC mint address on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function testJupiterApi() {
    logger.high('Starting Jupiter API integration test');

    try {
        // Get a test memecoin from DexScreener using getTrendingTokens instead of searchMemecoins
        const pairs = await dexScreener.getTrendingTokens();
        if (pairs.length === 0) {
            throw new Error('No tokens found via DexScreener to test with');
        }

        const testToken = pairs[0].baseToken;
        logger.high(`Testing Jupiter API with token: ${testToken.symbol} (${testToken.address})`);

        // Test quote fetching (buying 10 USDC worth of the memecoin)
        const amount = 10 * 1000000; // 10 USDC (6 decimals)
        logger.high(`Getting quote for ${amount / 1000000} USDC worth of ${testToken.symbol}`);
        
        const quote = await jupiterApi.getQuote(
            USDC_MINT,
            testToken.address,
            amount
        );

        if (quote) {
            logger.high('Quote received successfully:');
            logger.high(`- Input Amount: ${amount / 1000000} USDC`);
            logger.high(`- Output Amount: ${quote.outAmount}`);
            logger.high(`- Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%`);
            
            if (quote.routePlan && quote.routePlan.length > 0) {
                logger.high(`- Route Length: ${quote.routePlan.length} hop(s)`);
                quote.routePlan.forEach((hop, index) => {
                    logger.deep(`  Hop ${index + 1}: ${hop.swapInfo ? hop.swapInfo.label : 'Unknown'}`);
                });
            }
        }

        // Test route finding
        logger.high('\nFinding best route for the swap...');
        const routeAnalysis = await jupiterApi.findBestRoute(
            USDC_MINT,
            testToken.address,
            amount
        );

        if (routeAnalysis) {
            logger.high('Route analysis completed:');
            logger.high(`- Valid Route: ${routeAnalysis.valid}`);
            logger.high(`- Price Impact: ${routeAnalysis.priceImpact}%`);
            logger.high(`- Output Amount: ${routeAnalysis.outAmount}`);
            if (routeAnalysis.route) {
                logger.high(`- Number of Hops: ${routeAnalysis.route.length}`);
            }
        }

    } catch (error) {
        logger.error(`Test suite failed: ${error.message}`);
        throw error;
    }
}

// Run the test
testJupiterApi().catch(error => {
    logger.error(`Fatal error in test suite: ${error.message}`);
    process.exit(1);
});
