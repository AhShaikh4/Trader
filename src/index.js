// Main entry point for the Trader application
const logger = require('./logger');
const dexscreener = require('./dexscreener');
const birdeye = require('./birdeye');
const moralis = require('./moralis');
const jupiter = require('./jupiter');
const wallet = require('./wallet');
const fetchAnalyze = require('./fetchanalyze');

// Initialize the application
async function initialize() {
  try {
    logger.high('Initializing Trader application...');
    
    // Initialize Moralis
    await moralis.initMoralis();
    
    // Initialize wallet
    const walletInitialized = wallet.initialize();
    if (!walletInitialized) {
      throw new Error('Failed to initialize wallet');
    }
    
    logger.high('Trader application initialized successfully');
    return true;
  } catch (error) {
    logger.error(`Initialization failed: ${error.message}`);
    return false;
  }
}

// Discover new tokens
async function discoverTokens() {
  try {
    logger.high('Starting token discovery process...');
    const discoveredTokens = await fetchAnalyze.discoverNewTokens();
    logger.high(`Discovered ${discoveredTokens.length} tokens`);
    return discoveredTokens;
  } catch (error) {
    logger.error(`Token discovery failed: ${error.message}`);
    return [];
  }
}

// Analyze a specific token
async function analyzeToken(tokenAddress) {
  try {
    logger.high(`Analyzing token: ${tokenAddress}`);
    const analysis = await fetchAnalyze.comprehensiveTokenAnalysis(tokenAddress);
    logger.high('Token analysis complete');
    return analysis;
  } catch (error) {
    logger.error(`Token analysis failed: ${error.message}`);
    return null;
  }
}

// Get trending tokens
async function getTrendingTokens() {
  try {
    logger.high('Fetching trending tokens...');
    const trendingTokens = await dexscreener.getTrendingTokens();
    logger.high(`Found ${trendingTokens.length} trending tokens`);
    return trendingTokens;
  } catch (error) {
    logger.error(`Failed to fetch trending tokens: ${error.message}`);
    return [];
  }
}

// Export the main functions
module.exports = {
  initialize,
  discoverTokens,
  analyzeToken,
  getTrendingTokens,
  // Export modules for direct access if needed
  modules: {
    dexscreener,
    birdeye,
    moralis,
    jupiter,
    wallet,
    fetchAnalyze
  }
};
