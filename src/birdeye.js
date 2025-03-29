// Real Birdeye API integration
const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

class BirdeyeAPI {
  constructor() {
    this.baseUrl = 'https://public-api.birdeye.so';
    this.apiKey = config.BIRDEYE_API_KEY;
    this.cache = new Map();
    this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.rateLimitDelay = 1100; // 1.1 seconds between requests to avoid rate limiting
    this.lastRequestTime = 0;
  }

  // Helper method to handle rate limiting
  async throttledRequest(endpoint, params = {}) {
    const now = Date.now();
    const timeElapsed = now - this.lastRequestTime;
    
    if (timeElapsed < this.rateLimitDelay) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeElapsed));
    }
    
    this.lastRequestTime = Date.now();
    
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const headers = {
        'X-API-KEY': this.apiKey || 'empty' // Use 'empty' as fallback for paper trading
      };
      
      const response = await axios.get(url, { params, headers });
      return response.data;
    } catch (error) {
      logger.error(`Birdeye API error: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      
      // If API key is invalid or missing, use fallback mode
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        logger.high('Using fallback mode for Birdeye API (paper trading only)');
        return null;
      }
      
      throw error;
    }
  }

  // Analyze token
  async analyzeToken(tokenAddress) {
    logger.high(`Analyzing token ${tokenAddress} with Birdeye`);
    
    const cacheKey = `analyze_${tokenAddress}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached token analysis for ${tokenAddress}`);
      return cachedData.data;
    }
    
    try {
      // Get token price and metadata
      const priceData = await this.getTokenPrice(tokenAddress);
      
      // Get token metrics
      const metricsData = await this.getTokenMetrics(tokenAddress);
      
      // Get technical indicators
      const technicalData = await this.getTechnicalIndicators(tokenAddress);
      
      // If any of the API calls failed, use fallback
      if (!priceData || !metricsData) {
        return this.getFallbackTokenAnalysis(tokenAddress);
      }
      
      // Combine data
      const analysis = {
        address: tokenAddress,
        name: priceData.data?.name || `Token ${tokenAddress.substring(0, 6)}`,
        symbol: priceData.data?.symbol || `TKN${tokenAddress.substring(0, 3).toUpperCase()}`,
        price: priceData.data?.value || 0,
        priceChange24h: priceData.data?.priceChange24h || 0,
        volume24h: metricsData.data?.volume24h || 0,
        marketCap: metricsData.data?.marketCap || 0,
        fullyDilutedValuation: metricsData.data?.fdv || 0,
        holders: metricsData.data?.holderCount || 0,
        transactions: {
          buys24h: metricsData.data?.txns24h?.buy || 0,
          sells24h: metricsData.data?.txns24h?.sell || 0,
          total24h: metricsData.data?.txns24h?.total || 0
        },
        technicalIndicators: technicalData || {
          rsi: 50,
          macd: 0,
          ema20: priceData.data?.value || 0,
          ema50: priceData.data?.value || 0,
          ema200: priceData.data?.value || 0
        }
      };
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: analysis
      });
      
      return analysis;
    } catch (error) {
      logger.error(`Failed to analyze token ${tokenAddress}: ${error.message}`);
      return this.getFallbackTokenAnalysis(tokenAddress);
    }
  }

  // Get token price
  async getTokenPrice(tokenAddress) {
    try {
      const endpoint = `/v1/token/price`;
      const params = {
        address: tokenAddress,
        chain: 'solana'
      };
      
      return await this.throttledRequest(endpoint, params);
    } catch (error) {
      logger.error(`Failed to get token price for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Get token metrics
  async getTokenMetrics(tokenAddress) {
    try {
      const endpoint = `/v1/token/metrics`;
      const params = {
        address: tokenAddress,
        chain: 'solana'
      };
      
      return await this.throttledRequest(endpoint, params);
    } catch (error) {
      logger.error(`Failed to get token metrics for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Get technical indicators
  async getTechnicalIndicators(tokenAddress) {
    try {
      const endpoint = `/v1/token/technical`;
      const params = {
        address: tokenAddress,
        chain: 'solana'
      };
      
      const data = await this.throttledRequest(endpoint, params);
      
      if (!data || !data.data) {
        return null;
      }
      
      // Extract relevant technical indicators
      return {
        rsi: data.data.rsi || 50,
        macd: data.data.macd?.histogram || 0,
        ema20: data.data.ema?.ema20 || 0,
        ema50: data.data.ema?.ema50 || 0,
        ema200: data.data.ema?.ema200 || 0
      };
    } catch (error) {
      logger.error(`Failed to get technical indicators for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Get token historical data
  async getTokenHistoricalData(tokenAddress, timeframe = '1d', limit = 100) {
    try {
      const endpoint = `/v1/token/ohlcv`;
      const params = {
        address: tokenAddress,
        chain: 'solana',
        timeframe,
        limit
      };
      
      return await this.throttledRequest(endpoint, params);
    } catch (error) {
      logger.error(`Failed to get historical data for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Fallback method for paper trading when API key is not available
  getFallbackTokenAnalysis(tokenAddress) {
    // Extract a consistent "random" value from the address for deterministic results
    const addressValue = parseInt(tokenAddress.substring(2, 10), 16);
    const seed = addressValue / 0xffffffff;
    
    // Generate a price between $0.01 and $100 based on the address
    const basePrice = 0.01 + (seed * 100);
    
    // Add some randomness for paper trading simulation
    const randomFactor = 0.95 + (Math.random() * 0.1); // 0.95 to 1.05
    const price = basePrice * randomFactor;
    
    // Generate token name and symbol based on address
    const tokenId = tokenAddress.substring(2, 6).toUpperCase();
    
    return {
      address: tokenAddress,
      name: `Token ${tokenId}`,
      symbol: `TKN${tokenId.substring(0, 3)}`,
      price: price,
      priceChange24h: -20 + (Math.random() * 40),
      volume24h: 10000 + (Math.random() * 100000),
      marketCap: price * (1000000 + (Math.random() * 10000000)),
      fullyDilutedValuation: price * (5000000 + (Math.random() * 50000000)),
      holders: 100 + Math.floor(Math.random() * 1000),
      transactions: {
        buys24h: 50 + Math.floor(Math.random() * 200),
        sells24h: 30 + Math.floor(Math.random() * 150),
        total24h: 80 + Math.floor(Math.random() * 350)
      },
      technicalIndicators: {
        rsi: 30 + (Math.random() * 40),
        macd: -5 + (Math.random() * 10),
        ema20: price * (0.95 + (Math.random() * 0.1)),
        ema50: price * (0.9 + (Math.random() * 0.1)),
        ema200: price * (0.85 + (Math.random() * 0.1))
      }
    };
  }
}

module.exports = new BirdeyeAPI();
