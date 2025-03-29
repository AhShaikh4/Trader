const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

class PricePredictionModule {
  constructor() {
    this.predictions = new Map();
    this.predictionHistory = new Map();
    this.lastPredictionTime = 0;
    this.predictionInterval = 60 * 60 * 1000; // 1 hour
  }

  // Generate price predictions for a coin
  async predictPrice(coinId, timeframes = ['24h', '7d']) {
    try {
      logger.high(`Generating price predictions for ${coinId}`);
      
      // Get historical data for analysis
      const marketData = await coinGeckoAPI.getCoinMarketChart(coinId, 'usd', 30);
      if (!marketData || !marketData.prices || marketData.prices.length < 30) {
        logger.error(`Insufficient historical data for ${coinId}`);
        return null;
      }
      
      // Get technical analysis
      const analysis = await coinGeckoAPI.analyzePricePatterns(coinId);
      if (!analysis) {
        logger.error(`Failed to get technical analysis for ${coinId}`);
        return null;
      }
      
      // Extract price data
      const prices = marketData.prices.map(item => item[1]);
      const timestamps = marketData.prices.map(item => item[0]);
      const currentPrice = prices[prices.length - 1];
      
      // Generate predictions for each timeframe
      const predictions = {};
      
      for (const timeframe of timeframes) {
        let predictionDays;
        let confidenceLevel;
        
        // Set prediction parameters based on timeframe
        switch (timeframe) {
          case '24h':
            predictionDays = 1;
            confidenceLevel = 0.7; // Higher confidence for shorter timeframe
            break;
          case '7d':
            predictionDays = 7;
            confidenceLevel = 0.5; // Medium confidence for medium timeframe
            break;
          case '30d':
            predictionDays = 30;
            confidenceLevel = 0.3; // Lower confidence for longer timeframe
            break;
          default:
            predictionDays = 1;
            confidenceLevel = 0.6;
        }
        
        // Generate prediction using multiple methods and combine results
        const linearPrediction = this.linearRegressionPredictor(prices, predictionDays);
        const technicalPrediction = this.technicalAnalysisPredictor(analysis, predictionDays);
        const patternPrediction = this.patternBasedPredictor(prices, analysis.patterns, predictionDays);
        
        // Weighted average of predictions (adjust weights based on market conditions)
        let weights = {
          linear: 0.3,
          technical: 0.4,
          pattern: 0.3
        };
        
        // Adjust weights based on market conditions
        if (analysis.volatility > 10) {
          // In high volatility, technical analysis is more important
          weights = {
            linear: 0.2,
            technical: 0.5,
            pattern: 0.3
          };
        } else if (analysis.technicalIndicators.rsi > 70 || analysis.technicalIndicators.rsi < 30) {
          // In overbought/oversold conditions, pattern recognition is more important
          weights = {
            linear: 0.2,
            technical: 0.3,
            pattern: 0.5
          };
        }
        
        // Calculate weighted prediction
        const weightedPrediction = (
          linearPrediction * weights.linear +
          technicalPrediction * weights.technical +
          patternPrediction * weights.pattern
        );
        
        // Calculate expected price change
        const priceChange = ((weightedPrediction - currentPrice) / currentPrice) * 100;
        
        // Calculate prediction range (wider for lower confidence)
        const rangeFactor = (1 - confidenceLevel) * 2;
        const lowerBound = currentPrice * (1 + (priceChange / 100) * (1 - rangeFactor));
        const upperBound = currentPrice * (1 + (priceChange / 100) * (1 + rangeFactor));
        
        // Store prediction
        predictions[timeframe] = {
          currentPrice,
          predictedPrice: weightedPrediction,
          priceChange,
          lowerBound,
          upperBound,
          confidenceLevel,
          timestamp: Date.now(),
          expiryTime: Date.now() + (predictionDays * 24 * 60 * 60 * 1000)
        };
      }
      
      // Store prediction for tracking
      this.predictions.set(coinId, {
        predictions,
        timestamp: Date.now(),
        analysis
      });
      
      return {
        coinId,
        predictions,
        analysis: {
          rsi: analysis.technicalIndicators.rsi,
          macd: analysis.technicalIndicators.macd,
          patterns: analysis.patterns,
          recommendation: analysis.recommendation
        }
      };
    } catch (error) {
      logger.error(`Error predicting price for ${coinId}: ${error.message}`);
      return null;
    }
  }
  
  // Linear regression based price predictor
  linearRegressionPredictor(prices, predictionDays) {
    // Use recent price data (last 14 days)
    const recentPrices = prices.slice(-14);
    const n = recentPrices.length;
    
    // Create x values (0, 1, 2, ..., n-1)
    const x = Array.from({ length: n }, (_, i) => i);
    
    // Calculate means
    const meanX = x.reduce((sum, val) => sum + val, 0) / n;
    const meanY = recentPrices.reduce((sum, val) => sum + val, 0) / n;
    
    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < n; i++) {
      numerator += (x[i] - meanX) * (recentPrices[i] - meanY);
      denominator += Math.pow(x[i] - meanX, 2);
    }
    
    const slope = numerator / denominator;
    const intercept = meanY - (slope * meanX);
    
    // Predict future price
    const futureDays = n + predictionDays;
    const predictedPrice = (slope * futureDays) + intercept;
    
    return predictedPrice;
  }
  
  // Technical analysis based predictor
  technicalAnalysisPredictor(analysis, predictionDays) {
    const currentPrice = analysis.currentPrice;
    let priceChangeMultiplier = 1.0;
    
    // Adjust based on RSI
    if (analysis.technicalIndicators.rsi > 70) {
      // Overbought - expect correction
      priceChangeMultiplier *= (1 - (0.01 * predictionDays));
    } else if (analysis.technicalIndicators.rsi < 30) {
      // Oversold - expect bounce
      priceChangeMultiplier *= (1 + (0.01 * predictionDays));
    }
    
    // Adjust based on MACD
    if (analysis.technicalIndicators.macd.histogram > 0) {
      // Bullish MACD
      priceChangeMultiplier *= (1 + (0.005 * predictionDays));
    } else {
      // Bearish MACD
      priceChangeMultiplier *= (1 - (0.005 * predictionDays));
    }
    
    // Adjust based on SMA relationship
    if (analysis.technicalIndicators.sma.sma7 > analysis.technicalIndicators.sma.sma25) {
      // Bullish trend
      priceChangeMultiplier *= (1 + (0.003 * predictionDays));
    } else {
      // Bearish trend
      priceChangeMultiplier *= (1 - (0.003 * predictionDays));
    }
    
    return currentPrice * priceChangeMultiplier;
  }
  
  // Pattern-based predictor
  patternBasedPredictor(prices, patterns, predictionDays) {
    const currentPrice = prices[prices.length - 1];
    let priceChangeMultiplier = 1.0;
    
    // Adjust based on identified patterns
    if (patterns.uptrend) {
      priceChangeMultiplier *= (1 + (0.01 * predictionDays));
    }
    
    if (patterns.strongUptrend) {
      priceChangeMultiplier *= (1 + (0.02 * predictionDays));
    }
    
    if (patterns.downtrend) {
      priceChangeMultiplier *= (1 - (0.01 * predictionDays));
    }
    
    if (patterns.strongDowntrend) {
      priceChangeMultiplier *= (1 - (0.02 * predictionDays));
    }
    
    if (patterns.overbought) {
      priceChangeMultiplier *= (1 - (0.015 * predictionDays));
    }
    
    if (patterns.oversold) {
      priceChangeMultiplier *= (1 + (0.015 * predictionDays));
    }
    
    if (patterns.bullishMACDCrossover) {
      priceChangeMultiplier *= (1 + (0.02 * predictionDays));
    }
    
    if (patterns.bearishMACDCrossover) {
      priceChangeMultiplier *= (1 - (0.02 * predictionDays));
    }
    
    return currentPrice * priceChangeMultiplier;
  }
  
  // Generate predictions for multiple coins
  async generatePredictions(coinIds) {
    const now = Date.now();
    
    // Only regenerate predictions every hour
    if (now - this.lastPredictionTime < this.predictionInterval) {
      return this.getStoredPredictions(coinIds);
    }
    
    this.lastPredictionTime = now;
    logger.high(`Generating price predictions for ${coinIds.length} coins`);
    
    const results = [];
    
    for (const coinId of coinIds) {
      try {
        const prediction = await this.predictPrice(coinId);
        if (prediction) {
          results.push(prediction);
          
          // Store prediction history for tracking accuracy
          this.trackPredictionHistory(coinId, prediction);
        }
      } catch (error) {
        logger.error(`Error generating prediction for ${coinId}: ${error.message}`);
      }
    }
    
    return results;
  }
  
  // Get stored predictions without regenerating
  getStoredPredictions(coinIds) {
    const results = [];
    
    for (const coinId of coinIds) {
      const storedPrediction = this.predictions.get(coinId);
      if (storedPrediction) {
        results.push({
          coinId,
          predictions: storedPrediction.predictions,
          analysis: storedPrediction.analysis,
          timestamp: storedPrediction.timestamp
        });
      }
    }
    
    return results;
  }
  
  // Track prediction history for accuracy analysis
  trackPredictionHistory(coinId, prediction) {
    if (!this.predictionHistory.has(coinId)) {
      this.predictionHistory.set(coinId, []);
    }
    
    const history = this.predictionHistory.get(coinId);
    history.push({
      timestamp: Date.now(),
      prediction
    });
    
    // Keep only last 30 predictions
    if (history.length > 30) {
      history.shift();
    }
    
    this.predictionHistory.set(coinId, history);
  }
  
  // Evaluate prediction accuracy
  async evaluatePredictionAccuracy(coinId) {
    if (!this.predictionHistory.has(coinId)) {
      return null;
    }
    
    const history = this.predictionHistory.get(coinId);
    const accuracyResults = {
      '24h': {
        totalPredictions: 0,
        correctDirection: 0,
        withinRange: 0,
        averageError: 0
      },
      '7d': {
        totalPredictions: 0,
        correctDirection: 0,
        withinRange: 0,
        averageError: 0
      }
    };
    
    // Get current price
    const marketData = await coinGeckoAPI.getCoinMarketChart(coinId, 'usd', 30);
    if (!marketData || !marketData.prices || marketData.prices.length === 0) {
      return null;
    }
    
    const currentPrice = marketData.prices[marketData.prices.length - 1][1];
    const now = Date.now();
    
    // Evaluate each historical prediction
    for (const item of history) {
      const { prediction, timestamp } = item;
      
      // Check if prediction has matured
      for (const [timeframe, pred] of Object.entries(prediction.predictions)) {
        if (timeframe === '24h' && now - timestamp >= 24 * 60 * 60 * 1000) {
          // 24h prediction has matured
          this.evaluateSinglePrediction(accuracyResults['24h'], pred, currentPrice);
        } else if (timeframe === '7d' && now - timestamp >= 7 * 24 * 60 * 60 * 1000) {
          // 7d prediction has matured
          this.evaluateSinglePrediction(accuracyResults['7d'], pred, currentPrice);
        }
      }
    }
    
    // Calculate percentages
    for (const timeframe of Object.keys(accuracyResults)) {
      const result = accuracyResults[timeframe];
      if (result.totalPredictions > 0) {
        result.correctDirectionPercent = (result.correctDirection / result.totalPredictions) * 100;
        result.withinRangePercent = (result.withinRange / result.totalPredictions) * 100;
        result.averageError = result.averageError / result.totalPredictions;
      }
    }
    
    return {
      coinId,
      accuracyResults,
      evaluatedAt: now
    };
  }
  
  // Evaluate a single prediction
  evaluateSinglePrediction(result, prediction, actualPrice) {
    result.totalPredictions++;
    
    // Check if direction was correct
    const predictedDirection = prediction.priceChange > 0;
    const actualDirection = actualPrice > prediction.currentPrice;
    
    if (predictedDirection === actualDirection) {
      result.correctDirection++;
    }
    
    // Check if actual price is within predicted range
    if (actualPrice >= prediction.lowerBound && actualPrice <= prediction.upperBound) {
      result.withinRange++;
    }
    
    // Calculate error percentage
    const errorPercent = Math.abs((actualPrice - prediction.predictedPrice) / prediction.predictedPrice) * 100;
    result.averageError += errorPercent;
  }
}

const pricePredictionModule = new PricePredictionModule();
module.exports = pricePredictionModule;
