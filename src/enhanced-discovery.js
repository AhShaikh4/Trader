const dexscreener = require('../dexscreener');
const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

// Enhanced token discovery that integrates CoinGecko data
class EnhancedTokenDiscovery {
  constructor() {
    this.discoveredTokens = new Map();
    this.lastAnalysisTime = 0;
    this.analysisInterval = 15 * 60 * 1000; // 15 minutes
  }

  // Main discovery method that combines DexScreener and CoinGecko data
  async discoverProfitableTokens(limit = 20) {
    logger.high('Starting enhanced token discovery with DexScreener and CoinGecko integration');
    
    try {
      // Step 1: Get tokens from DexScreener
      logger.deep('Fetching tokens from DexScreener');
      const dexScreenerTokens = await dexscreener.discoverTokens();
      logger.high(`Found ${dexScreenerTokens.length} tokens from DexScreener`);
      
      // Step 2: Get profitable coins from CoinGecko
      logger.deep('Fetching profitable coins from CoinGecko');
      const coinGeckoTokens = await coinGeckoAPI.findProfitableCoins(10);
      logger.high(`Found ${coinGeckoTokens.length} profitable coins from CoinGecko`);
      
      // Step 3: Get trending coins from CoinGecko
      logger.deep('Fetching trending coins from CoinGecko');
      const trendingCoins = await coinGeckoAPI.getTrendingCoins();
      logger.high(`Found ${trendingCoins.length} trending coins from CoinGecko`);
      
      // Step 4: Combine and score all tokens
      const combinedTokens = await this.combineAndScoreTokens(
        dexScreenerTokens, 
        coinGeckoTokens, 
        trendingCoins
      );
      
      // Step 5: Sort by final score and take top tokens
      combinedTokens.sort((a, b) => b.finalScore - a.finalScore);
      const topTokens = combinedTokens.slice(0, limit);
      
      // Step 6: Store discovered tokens for tracking
      this.updateDiscoveredTokens(topTokens);
      
      logger.high(`Discovered ${topTokens.length} high-potential tokens using enhanced discovery`);
      return topTokens;
    } catch (error) {
      logger.error(`Error in enhanced token discovery: ${error.message}`);
      
      // Fallback to DexScreener only if CoinGecko integration fails
      logger.deep('Falling back to DexScreener-only discovery');
      return dexscreener.discoverTokens();
    }
  }
  
  // Combine and score tokens from different sources
  async combineAndScoreTokens(dexScreenerTokens, coinGeckoTokens, trendingCoins) {
    const combinedTokens = [];
    const processedAddresses = new Set();
    
    // Process DexScreener tokens
    for (const token of dexScreenerTokens) {
      if (token.baseToken?.address && !processedAddresses.has(token.baseToken.address)) {
        processedAddresses.add(token.baseToken.address);
        
        // Calculate base score from DexScreener data
        let baseScore = token.profitPotentialScore || 50;
        
        // Create combined token object
        combinedTokens.push({
          source: 'dexscreener',
          token,
          baseScore,
          coinGeckoData: null,
          isTrending: false,
          finalScore: baseScore
        });
      }
    }
    
    // Process CoinGecko profitable tokens
    for (const coin of coinGeckoTokens) {
      // Create a unique identifier for CoinGecko coins
      const coinId = `coingecko:${coin.id}`;
      
      if (!processedAddresses.has(coinId)) {
        processedAddresses.add(coinId);
        
        // Use CoinGecko's score
        const baseScore = coin.finalScore || 50;
        
        // Create combined token object
        combinedTokens.push({
          source: 'coingecko',
          token: {
            baseToken: {
              name: coin.name,
              symbol: coin.symbol,
              address: coinId
            },
            priceUsd: coin.analysis?.currentPrice || 0,
            priceChange: {
              h24: coin.analysis?.priceChange24h || 0
            },
            liquidity: {
              usd: 0 // Not available from CoinGecko
            },
            volume: {
              h24: 0 // Not available in this format
            }
          },
          baseScore,
          coinGeckoData: coin,
          isTrending: false,
          finalScore: baseScore
        });
      }
    }
    
    // Mark trending coins and boost their scores
    for (const trendingCoin of trendingCoins) {
      const coinId = `coingecko:${trendingCoin.id}`;
      
      // Check if this coin is already in our combined list
      let found = false;
      for (const combinedToken of combinedTokens) {
        if (
          (combinedToken.source === 'coingecko' && combinedToken.token.baseToken.address === coinId) ||
          (combinedToken.coinGeckoData && combinedToken.coinGeckoData.id === trendingCoin.id)
        ) {
          // Mark as trending and boost score
          combinedToken.isTrending = true;
          combinedToken.finalScore += 15; // Significant boost for trending coins
          found = true;
          break;
        }
      }
      
      // If not found, add it as a new entry
      if (!found && !processedAddresses.has(coinId)) {
        processedAddresses.add(coinId);
        
        // Base score for trending coins
        const baseScore = 70; // Higher starting score for trending coins
        
        combinedTokens.push({
          source: 'coingecko',
          token: {
            baseToken: {
              name: trendingCoin.name,
              symbol: trendingCoin.symbol,
              address: coinId
            },
            priceUsd: 0, // Not available in trending data
            priceChange: {
              h24: 0 // Not available in trending data
            },
            liquidity: {
              usd: 0 // Not available in trending data
            },
            volume: {
              h24: 0 // Not available in trending data
            }
          },
          baseScore,
          coinGeckoData: trendingCoin,
          isTrending: true,
          finalScore: baseScore + 15 // Include trending boost
        });
      }
    }
    
    // Apply additional scoring factors
    for (const combinedToken of combinedTokens) {
      // Boost tokens with high 24h price change (either positive or negative)
      const priceChange24h = Math.abs(combinedToken.token.priceChange?.h24 || 0);
      if (priceChange24h > 20) {
        combinedToken.finalScore += 10;
      } else if (priceChange24h > 10) {
        combinedToken.finalScore += 5;
      }
      
      // Boost tokens with good liquidity-to-volume ratio
      const liquidity = combinedToken.token.liquidity?.usd || 0;
      const volume = combinedToken.token.volume?.h24 || 0;
      
      if (liquidity > 0 && volume > 0) {
        const volumeToLiquidityRatio = volume / liquidity;
        
        if (volumeToLiquidityRatio > 5) {
          combinedToken.finalScore += 15;
        } else if (volumeToLiquidityRatio > 2) {
          combinedToken.finalScore += 10;
        } else if (volumeToLiquidityRatio > 1) {
          combinedToken.finalScore += 5;
        }
      }
      
      // Cap final score at 100
      combinedToken.finalScore = Math.min(100, combinedToken.finalScore);
    }
    
    return combinedTokens;
  }
  
  // Update the map of discovered tokens for tracking
  updateDiscoveredTokens(tokens) {
    const now = Date.now();
    
    for (const token of tokens) {
      const address = token.token.baseToken.address;
      const symbol = token.token.baseToken.symbol;
      
      if (!this.discoveredTokens.has(address)) {
        this.discoveredTokens.set(address, {
          symbol,
          firstDiscovered: now,
          lastSeen: now,
          occurrences: 1,
          highestScore: token.finalScore,
          currentScore: token.finalScore
        });
      } else {
        const tracking = this.discoveredTokens.get(address);
        tracking.lastSeen = now;
        tracking.occurrences += 1;
        tracking.currentScore = token.finalScore;
        tracking.highestScore = Math.max(tracking.highestScore, token.finalScore);
        this.discoveredTokens.set(address, tracking);
      }
    }
  }
  
  // Get token discovery statistics
  getDiscoveryStats() {
    const now = Date.now();
    const stats = {
      totalDiscovered: this.discoveredTokens.size,
      recentlyDiscovered: 0, // Last 24 hours
      persistentTokens: 0,    // Seen more than 5 times
      highPotentialTokens: 0  // Score > 80
    };
    
    for (const [address, tracking] of this.discoveredTokens.entries()) {
      // Count recently discovered tokens (last 24 hours)
      if (now - tracking.firstDiscovered < 24 * 60 * 60 * 1000) {
        stats.recentlyDiscovered++;
      }
      
      // Count persistent tokens
      if (tracking.occurrences > 5) {
        stats.persistentTokens++;
      }
      
      // Count high potential tokens
      if (tracking.highestScore > 80) {
        stats.highPotentialTokens++;
      }
    }
    
    return stats;
  }
  
  // Analyze token performance over time
  async analyzeTokenPerformance() {
    const now = Date.now();
    
    // Only run analysis every 15 minutes
    if (now - this.lastAnalysisTime < this.analysisInterval) {
      return null;
    }
    
    this.lastAnalysisTime = now;
    logger.high('Running token performance analysis');
    
    const persistentTokens = [];
    
    // Find tokens that have been consistently discovered
    for (const [address, tracking] of this.discoveredTokens.entries()) {
      if (tracking.occurrences > 3 && tracking.highestScore > 70) {
        persistentTokens.push({
          address,
          symbol: tracking.symbol,
          occurrences: tracking.occurrences,
          highestScore: tracking.highestScore,
          currentScore: tracking.currentScore,
          firstDiscovered: tracking.firstDiscovered,
          lastSeen: tracking.lastSeen,
          age: now - tracking.firstDiscovered
        });
      }
    }
    
    // Sort by highest score
    persistentTokens.sort((a, b) => b.highestScore - a.highestScore);
    
    // Take top 5 for detailed analysis
    const topTokens = persistentTokens.slice(0, 5);
    const analysisResults = [];
    
    // Perform detailed analysis on top tokens
    for (const token of topTokens) {
      try {
        // For CoinGecko tokens, we can get detailed analysis
        if (token.address.startsWith('coingecko:')) {
          const coinId = token.address.replace('coingecko:', '');
          const analysis = await coinGeckoAPI.analyzePricePatterns(coinId);
          
          if (analysis) {
            analysisResults.push({
              symbol: token.symbol,
              address: token.address,
              score: token.highestScore,
              occurrences: token.occurrences,
              age: token.age,
              analysis
            });
          }
        }
      } catch (error) {
        logger.error(`Error analyzing token ${token.symbol}: ${error.message}`);
      }
    }
    
    return {
      timestamp: now,
      persistentTokensCount: persistentTokens.length,
      topTokensAnalyzed: analysisResults.length,
      results: analysisResults
    };
  }
}

const enhancedTokenDiscovery = new EnhancedTokenDiscovery();
module.exports = enhancedTokenDiscovery;
