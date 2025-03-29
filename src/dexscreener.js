# DexScreener API Fix

// Fix DexScreener API endpoint
const axios = require('axios');
const logger = require('./logger');

class DexScreenerAPI {
  constructor() {
    this.baseUrl = 'https://api.dexscreener.com/latest';
    this.cache = new Map();
    this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.rateLimitDelay = 1100; // 1.1 seconds between requests to avoid rate limiting
    this.lastRequestTime = 0;
  }

  // Helper method to handle rate limiting
  async throttledRequest(url, params = {}) {
    const now = Date.now();
    const timeElapsed = now - this.lastRequestTime;
    
    if (timeElapsed < this.rateLimitDelay) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeElapsed));
    }
    
    this.lastRequestTime = Date.now();
    
    try {
      const response = await axios.get(url, { params });
      return response.data;
    } catch (error) {
      logger.error(`DexScreener API error: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // Get trending tokens
  async getTrendingTokens() {
    logger.high('Fetching trending tokens from DexScreener');
    
    const cacheKey = 'trendingTokens';
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep('Using cached trending tokens data');
      return cachedData.data;
    }
    
    try {
      // Use the correct endpoint for Solana pairs
      const url = `${this.baseUrl}/dexs/solana/pairs`;
      const data = await this.throttledRequest(url);
      
      if (!data || !data.pairs || !Array.isArray(data.pairs)) {
        throw new Error('Invalid response from DexScreener API');
      }
      
      // Filter and sort pairs by volume
      const validPairs = data.pairs.filter(pair => {
        return pair && 
               pair.baseToken && 
               pair.quoteToken && 
               pair.liquidity && 
               pair.liquidity.usd > 10000 && // Minimum liquidity $10k
               pair.volume && 
               pair.volume.h24 > 1000; // Minimum 24h volume $1k
      });
      
      // Sort by 24h volume
      const sortedPairs = validPairs.sort((a, b) => {
        return (b.volume.h24 || 0) - (a.volume.h24 || 0);
      });
      
      // Take top 20 pairs
      const trendingTokens = sortedPairs.slice(0, 20);
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: trendingTokens
      });
      
      return trendingTokens;
    } catch (error) {
      logger.error(`Failed to get trending tokens: ${error.message}`);
      
      // If API fails, return empty array to avoid breaking the application
      return [];
    }
  }

  // Get token pools
  async getTokenPools(tokenAddress) {
    logger.high(`Fetching token pools for ${tokenAddress}`);
    
    const cacheKey = `tokenPools_${tokenAddress}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached token pools data for ${tokenAddress}`);
      return cachedData.data;
    }
    
    try {
      // Get all pairs for this token
      const url = `${this.baseUrl}/search/pairs`;
      const params = { query: tokenAddress };
      const data = await this.throttledRequest(url, params);
      
      if (!data || !data.pairs || !Array.isArray(data.pairs)) {
        throw new Error('Invalid response from DexScreener API');
      }
      
      // Filter pairs to only include those with the specified token address
      const tokenPools = data.pairs.filter(pair => {
        return pair && 
               ((pair.baseToken && pair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase()) ||
                (pair.quoteToken && pair.quoteToken.address.toLowerCase() === tokenAddress.toLowerCase()));
      });
      
      // Sort by liquidity
      const sortedPools = tokenPools.sort((a, b) => {
        return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
      });
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: sortedPools
      });
      
      return sortedPools;
    } catch (error) {
      logger.error(`Failed to get token pools for ${tokenAddress}: ${error.message}`);
      
      // If API fails, return empty array to avoid breaking the application
      return [];
    }
  }

  // Get pair data
  async getPairData(pairAddress) {
    logger.high(`Fetching pair data for ${pairAddress}`);
    
    const cacheKey = `pairData_${pairAddress}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached pair data for ${pairAddress}`);
      return cachedData.data;
    }
    
    try {
      const url = `${this.baseUrl}/search/pairs`;
      const params = { query: pairAddress };
      const data = await this.throttledRequest(url, params);
      
      if (!data || !data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        throw new Error('Invalid response from DexScreener API');
      }
      
      // Find the exact pair
      const pair = data.pairs.find(p => p.pairAddress.toLowerCase() === pairAddress.toLowerCase());
      
      if (!pair) {
        throw new Error(`Pair ${pairAddress} not found`);
      }
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: pair
      });
      
      return pair;
    } catch (error) {
      logger.error(`Failed to get pair data for ${pairAddress}: ${error.message}`);
      return null;
    }
  }

  // Search tokens
  async searchTokens(query) {
    logger.high(`Searching tokens with query: ${query}`);
    
    const cacheKey = `searchTokens_${query}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached search results for query: ${query}`);
      return cachedData.data;
    }
    
    try {
      const url = `${this.baseUrl}/search/tokens`;
      const params = { query };
      const data = await this.throttledRequest(url, params);
      
      if (!data || !data.pairs || !Array.isArray(data.pairs)) {
        throw new Error('Invalid response from DexScreener API');
      }
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: data.pairs
      });
      
      return data.pairs;
    } catch (error) {
      logger.error(`Failed to search tokens with query ${query}: ${error.message}`);
      return [];
    }
  }
}

module.exports = new DexScreenerAPI();
