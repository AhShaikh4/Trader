// Real CoinGecko API integration
const axios = require('axios');
const logger = require('./logger');

class CoinGeckoAPI {
  constructor() {
    this.baseUrl = 'https://api.coingecko.com/api/v3';
    this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.cache = new Map();
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
      logger.error(`CoinGecko API error: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // Get coin market chart data
  async getCoinMarketChart(coinId, currency, days) {
    logger.high(`Getting market chart for ${coinId} in ${currency} for ${days} days`);
    
    const cacheKey = `marketChart_${coinId}_${currency}_${days}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached market chart data for ${coinId}`);
      return cachedData.data;
    }
    
    try {
      const url = `${this.baseUrl}/coins/${coinId}/market_chart`;
      const params = { vs_currency: currency, days: days };
      
      const data = await this.throttledRequest(url, params);
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data
      });
      
      return data;
    } catch (error) {
      logger.error(`Failed to get market chart for ${coinId}: ${error.message}`);
      return null;
    }
  }

  // Analyze price patterns based on historical data
  async analyzePricePatterns(coinId) {
    logger.high(`Analyzing price patterns for ${coinId}`);
    
    try {
      // Get historical price data
      const marketData = await this.getCoinMarketChart(coinId, 'usd', 30);
      if (!marketData || !marketData.prices || marketData.prices.length < 30) {
        logger.error(`Insufficient historical data for ${coinId}`);
        return null;
      }
      
      // Get current price
      const currentPrice = marketData.prices[marketData.prices.length - 1][1];
      
      // Calculate technical indicators
      const prices = marketData.prices.map(item => item[1]);
      const technicalIndicators = this.calculateTechnicalIndicators(prices);
      
      // Identify patterns
      const patterns = this.identifyPricePatterns(prices, technicalIndicators);
      
      // Calculate volatility (standard deviation of daily returns)
      const volatility = this.calculateVolatility(prices);
      
      // Generate recommendation
      let recommendation = 'hold';
      if (technicalIndicators.rsi < 30 && patterns.oversold) {
        recommendation = 'buy';
      } else if (technicalIndicators.rsi > 70 && patterns.overbought) {
        recommendation = 'sell';
      }
      
      return {
        currentPrice,
        volatility,
        technicalIndicators,
        patterns,
        recommendation
      };
    } catch (error) {
      logger.error(`Failed to analyze price patterns for ${coinId}: ${error.message}`);
      return null;
    }
  }

  // Calculate technical indicators
  calculateTechnicalIndicators(prices) {
    // RSI (Relative Strength Index)
    const rsi = this.calculateRSI(prices);
    
    // MACD (Moving Average Convergence Divergence)
    const macd = this.calculateMACD(prices);
    
    // SMA (Simple Moving Average)
    const sma = {
      sma7: this.calculateSMA(prices, 7),
      sma25: this.calculateSMA(prices, 25),
      sma99: this.calculateSMA(prices, Math.min(99, prices.length - 1))
    };
    
    return {
      rsi,
      macd,
      sma
    };
  }

  // Calculate RSI (Relative Strength Index)
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      return 50; // Default to neutral if not enough data
    }
    
    let gains = 0;
    let losses = 0;
    
    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // Calculate RSI for the remaining prices
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      
      if (change >= 0) {
        avgGain = ((avgGain * (period - 1)) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = ((avgLoss * (period - 1)) - change) / period;
      }
    }
    
    if (avgLoss === 0) {
      return 100; // No losses, RSI is 100
    }
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // Calculate MACD (Moving Average Convergence Divergence)
  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12 - ema26;
    
    // Calculate signal line (9-day EMA of MACD line)
    const macdHistory = [];
    for (let i = 0; i < prices.length; i++) {
      const ema12Val = this.calculateEMA(prices.slice(0, i + 1), 12);
      const ema26Val = this.calculateEMA(prices.slice(0, i + 1), 26);
      macdHistory.push(ema12Val - ema26Val);
    }
    
    const signalLine = this.calculateEMA(macdHistory, 9);
    const histogram = macdLine - signalLine;
    
    return {
      value: macdLine,
      signal: signalLine,
      histogram
    };
  }

  // Calculate EMA (Exponential Moving Average)
  calculateEMA(prices, period) {
    if (prices.length < period) {
      return prices[prices.length - 1]; // Return last price if not enough data
    }
    
    const k = 2 / (period + 1);
    
    // Start with SMA for the initial EMA value
    let ema = this.calculateSMA(prices.slice(0, period), period);
    
    // Calculate EMA for the remaining prices
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    
    return ema;
  }

  // Calculate SMA (Simple Moving Average)
  calculateSMA(prices, period) {
    if (prices.length < period) {
      return prices[prices.length - 1]; // Return last price if not enough data
    }
    
    const sum = prices.slice(prices.length - period).reduce((total, price) => total + price, 0);
    return sum / period;
  }

  // Calculate volatility (standard deviation of daily returns)
  calculateVolatility(prices) {
    if (prices.length < 2) {
      return 0;
    }
    
    // Calculate daily returns
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] / prices[i - 1]) - 1);
    }
    
    // Calculate mean return
    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    
    // Calculate variance
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    
    // Calculate standard deviation (volatility)
    return Math.sqrt(variance) * 100; // Convert to percentage
  }

  // Identify price patterns
  identifyPricePatterns(prices, technicalIndicators) {
    const patterns = {
      uptrend: false,
      strongUptrend: false,
      downtrend: false,
      strongDowntrend: false,
      overbought: false,
      oversold: false,
      bullishMACDCrossover: false,
      bearishMACDCrossover: false
    };
    
    // Check for trends based on SMA relationships
    if (technicalIndicators.sma.sma7 > technicalIndicators.sma.sma25) {
      patterns.uptrend = true;
      if (technicalIndicators.sma.sma25 > technicalIndicators.sma.sma99) {
        patterns.strongUptrend = true;
      }
    }
    
    if (technicalIndicators.sma.sma7 < technicalIndicators.sma.sma25) {
      patterns.downtrend = true;
      if (technicalIndicators.sma.sma25 < technicalIndicators.sma.sma99) {
        patterns.strongDowntrend = true;
      }
    }
    
    // Check for overbought/oversold conditions based on RSI
    if (technicalIndicators.rsi > 70) {
      patterns.overbought = true;
    }
    
    if (technicalIndicators.rsi < 30) {
      patterns.oversold = true;
    }
    
    // Check for MACD crossovers
    if (technicalIndicators.macd.histogram > 0 && technicalIndicators.macd.histogram > 0) {
      patterns.bullishMACDCrossover = true;
    }
    
    if (technicalIndicators.macd.histogram < 0 && technicalIndicators.macd.histogram < 0) {
      patterns.bearishMACDCrossover = true;
    }
    
    return patterns;
  }

  // Get current price
  async getCurrentPrice(coinId, currency) {
    logger.high(`Getting current price for ${coinId} in ${currency}`);
    
    const cacheKey = `currentPrice_${coinId}_${currency}`;
    const cachedData = this.cache.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < this.cacheExpiryTime)) {
      logger.deep(`Using cached current price data for ${coinId}`);
      return cachedData.data;
    }
    
    try {
      const url = `${this.baseUrl}/simple/price`;
      const params = { 
        ids: coinId, 
        vs_currencies: currency,
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true
      };
      
      const data = await this.throttledRequest(url, params);
      
      if (!data || !data[coinId] || !data[coinId][currency]) {
        throw new Error(`Invalid response for ${coinId}`);
      }
      
      const price = data[coinId][currency];
      
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: price
      });
      
      return price;
    } catch (error) {
      logger.error(`Failed to get current price for ${coinId}: ${error.message}`);
      return null;
    }
  }
}

module.exports = new CoinGeckoAPI();
