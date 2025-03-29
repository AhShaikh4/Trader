// Mean Reversion Trading Strategy
const StrategyBase = require('./strategy-base');
const logger = require('../logger');
const fetchAnalyze = require('../fetchanalyze');
const pricePrediction = require('../price-prediction');
const jupiter = require('../jupiter');
const wallet = require('../wallet');

class MeanReversionStrategy extends StrategyBase {
  constructor() {
    super('Mean Reversion Strategy');
    
    // Strategy-specific parameters
    this.parameters = {
      minTokenScore: 6.0,           // Minimum token score to consider (0-10)
      minLiquidityUsd: 20000,       // Minimum liquidity in USD
      maxLiquidityUsd: 1000000,     // Maximum liquidity in USD
      oversoldRSI: 30,              // RSI level to consider oversold
      overboughtRSI: 70,            // RSI level to consider overbought
      minPriceDeviation: 0.15,      // Minimum price deviation from moving average (15%)
      lookbackPeriod: 24,           // Hours to look back for calculating moving average
      profitTarget: 0.1,            // 10% profit target
      stopLoss: 0.05,               // 5% stop loss
      maxHoldingPeriod: 48 * 60 * 60 * 1000, // 48 hours maximum holding time
      positionSizePercent: 0.05     // 5% of available capital per trade
    };
    
    // Override base risk parameters
    this.riskParameters.maxPositionSize = 0.05;
    this.riskParameters.stopLossPercentage = 0.05;
    this.riskParameters.takeProfitPercentage = 0.1;
    
    // Track current positions
    this.positions = [];
    
    // Track tokens being monitored
    this.monitoredTokens = new Map();
    
    // RSI calculation periods
    this.rsiPeriod = 14; // 14 periods for RSI calculation
  }
  
  // Initialize strategy
  async initialize() {
    await super.initialize();
    logger.high('Mean Reversion Strategy initialized');
    
    // Initial token discovery
    await this.discoverTokens();
    
    return true;
  }
  
  // Discover potential tokens
  async discoverTokens() {
    try {
      logger.high('Discovering potential tokens for mean reversion strategy');
      
      // Get trending tokens
      const trendingTokens = await fetchAnalyze.getTrendingTokens();
      logger.high(`Found ${trendingTokens.length} trending tokens`);
      
      // Filter and analyze tokens
      for (const token of trendingTokens) {
        // Skip tokens already being monitored
        if (this.monitoredTokens.has(token.baseToken?.address)) {
          continue;
        }
        
        // Analyze token
        const analysis = await fetchAnalyze.comprehensiveTokenAnalysis(token.baseToken?.address);
        
        if (!analysis) {
          continue;
        }
        
        // Check if token meets initial criteria
        if (this.meetsInitialCriteria(analysis)) {
          logger.high(`Token ${token.baseToken?.symbol} (${token.baseToken?.address}) meets initial criteria for mean reversion`);
          
          // Add to monitored tokens
          this.monitoredTokens.set(token.baseToken?.address, {
            address: token.baseToken?.address,
            symbol: token.baseToken?.symbol,
            analysis,
            monitoringSince: Date.now(),
            priceHistory: [],
            lastUpdated: Date.now()
          });
        }
      }
      
      logger.high(`Now monitoring ${this.monitoredTokens.size} tokens for mean reversion strategy`);
      return Array.from(this.monitoredTokens.values());
    } catch (error) {
      logger.error(`Error discovering tokens: ${error.message}`);
      return [];
    }
  }
  
  // Check if token meets initial criteria
  meetsInitialCriteria(analysis) {
    // Skip if no analysis or main pool
    if (!analysis || !analysis.dexscreener || !analysis.dexscreener.pools || analysis.dexscreener.pools.length === 0) {
      return false;
    }
    
    const mainPool = analysis.dexscreener.pools[0];
    
    // Check token score
    if (analysis.score < this.parameters.minTokenScore) {
      return false;
    }
    
    // Check liquidity
    const liquidity = mainPool.liquidity?.usd || 0;
    if (liquidity < this.parameters.minLiquidityUsd || liquidity > this.parameters.maxLiquidityUsd) {
      return false;
    }
    
    // Check if token has been around for a while (mean reversion works better on established tokens)
    const pairCreatedAt = mainPool.pairCreatedAt ? new Date(mainPool.pairCreatedAt).getTime() : 0;
    const tokenAge = Date.now() - pairCreatedAt;
    if (tokenAge < 7 * 24 * 60 * 60 * 1000) { // At least 7 days old
      return false;
    }
    
    return true;
  }
  
  // Update token data
  async updateTokenData() {
    for (const [address, tokenData] of this.monitoredTokens.entries()) {
      try {
        // Skip tokens updated in the last 5 minutes
        if (Date.now() - tokenData.lastUpdated < 5 * 60 * 1000) {
          continue;
        }
        
        // Get updated analysis
        const analysis = await fetchAnalyze.comprehensiveTokenAnalysis(address);
        
        if (!analysis) {
          continue;
        }
        
        // Update token data
        tokenData.analysis = analysis;
        tokenData.lastUpdated = Date.now();
        
        // Update price history
        if (analysis.price) {
          tokenData.priceHistory.push({
            price: analysis.price,
            timestamp: Date.now()
          });
          
          // Keep only last 7 days of price history
          const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
          tokenData.priceHistory = tokenData.priceHistory.filter(p => p.timestamp >= sevenDaysAgo);
        }
        
        this.monitoredTokens.set(address, tokenData);
      } catch (error) {
        logger.error(`Error updating token ${address}: ${error.message}`);
      }
    }
  }
  
  // Calculate RSI (Relative Strength Index)
  calculateRSI(priceHistory) {
    if (priceHistory.length < this.rsiPeriod + 1) {
      return null;
    }
    
    // Get price changes
    const prices = priceHistory.map(p => p.price);
    const changes = [];
    
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i-1]);
    }
    
    // Calculate gains and losses
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
    
    // Calculate average gain and average loss
    const period = Math.min(this.rsiPeriod, gains.length);
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;
    
    // Calculate RSI for first period
    let rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss); // Avoid division by zero
    let rsi = 100 - (100 / (1 + rs));
    
    // Calculate RSI for remaining periods using smoothing
    for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
      
      rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
      rsi = 100 - (100 / (1 + rs));
    }
    
    return rsi;
  }
  
  // Calculate moving average
  calculateMA(priceHistory, period) {
    if (priceHistory.length < period) {
      return null;
    }
    
    const prices = priceHistory.map(p => p.price);
    const sum = prices.slice(-period).reduce((sum, price) => sum + price, 0);
    return sum / period;
  }
  
  // Check for entry signals
  async checkEntrySignals() {
    for (const [address, tokenData] of this.monitoredTokens.entries()) {
      try {
        // Skip if we don't have enough price history
        if (tokenData.priceHistory.length < this.rsiPeriod + 1) {
          continue;
        }
        
        // Check if we already have a position for this token
        if (this.positions.some(p => p.tokenAddress === address)) {
          continue;
        }
        
        // Check for mean reversion signal
        if (this.hasMeanReversionSignal(tokenData)) {
          logger.high(`Mean reversion signal detected for ${tokenData.symbol} (${address})`);
          
          // Check risk parameters
          const balance = await wallet.getBalance();
          const positionSize = this.calculatePositionSize(balance * 1e9, this.parameters.positionSizePercent);
          
          const currentPrice = tokenData.priceHistory[tokenData.priceHistory.length - 1].price;
          const isLong = this.isLongSignal(tokenData); // Determine if this is a long or short signal
          
          const trade = {
            tokenAddress: address,
            tokenSymbol: tokenData.symbol,
            entryPrice: currentPrice,
            positionSize,
            entryTime: Date.now(),
            isLong,
            stopLossPrice: isLong ? 
              this.calculateStopLoss(currentPrice, true) : 
              this.calculateStopLoss(currentPrice, false),
            takeProfitPrice: isLong ? 
              this.calculateTakeProfit(currentPrice, true) : 
              this.calculateTakeProfit(currentPrice, false),
            totalCapital: balance * 1e9,
            portfolioValueBeforeTrade: balance * 1e9
          };
          
          if (this.meetsRiskCriteria(trade)) {
            // Paper trade - simulate entry
            logger.high(`Entering ${isLong ? 'LONG' : 'SHORT'} position for ${tokenData.symbol} at ${trade.entryPrice}`);
            
            // Add to positions
            this.positions.push({
              ...trade,
              currentPrice: trade.entryPrice,
              lastUpdated: Date.now(),
              unrealizedPnl: 0,
              unrealizedPnlPercent: 0
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking entry signals for ${address}: ${error.message}`);
      }
    }
  }
  
  // Check for mean reversion signal
  hasMeanReversionSignal(tokenData) {
    // Calculate RSI
    const rsi = this.calculateRSI(tokenData.priceHistory);
    if (rsi === null) {
      return false;
    }
    
    // Calculate moving average
    const lookbackPeriods = Math.min(
      Math.floor(this.parameters.lookbackPeriod * 60 * 60 * 1000 / 
        ((Date.now() - tokenData.priceHistory[0].timestamp) / tokenData.priceHistory.length)),
      tokenData.priceHistory.length
    );
    
    const ma = this.calculateMA(tokenData.priceHistory, lookbackPeriods);
    if (ma === null) {
      return false;
    }
    
    // Get current price
    const currentPrice = tokenData.priceHistory[tokenData.priceHistory.length - 1].price;
    
    // Calculate price deviation from moving average
    const deviation = Math.abs(currentPrice - ma) / ma;
    
    // Check for oversold or overbought conditions
    const isOversold = rsi <= this.parameters.oversoldRSI;
    const isOverbought = rsi >= this.parameters.overboughtRSI;
    
    // Check for significant deviation from moving average
    const hasSignificantDeviation = deviation >= this.parameters.minPriceDeviation;
    
    // Mean reversion signal: oversold/overbought + significant deviation from MA
    return (isOversold || isOverbought) && hasSignificantDeviation;
  }
  
  // Determine if this is a long or short signal
  isLongSignal(tokenData) {
    const rsi = this.calculateRSI(tokenData.priceHistory);
    // Long signal if RSI is oversold (buy low)
    return rsi <= this.parameters.oversoldRSI;
  }
  
  // Update positions
  async updatePositions() {
    for (let i = 0; i < this.positions.length; i++) {
      const position = this.positions[i];
      
      try {
        // Get current token data
        const tokenData = this.monitoredTokens.get(position.tokenAddress);
        
        if (!tokenData || tokenData.priceHistory.length === 0) {
          continue;
        }
        
        // Update current price
        const currentPrice = tokenData.priceHistory[tokenData.priceHistory.length - 1].price;
        position.currentPrice = currentPrice;
        position.lastUpdated = Date.now();
        
        // Calculate unrealized P&L based on long/short
        if (position.isLong) {
          position.unrealizedPnl = (currentPrice - position.entryPrice) * position.positionSize / position.entryPrice;
          position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
          position.unrealizedPnl = (position.entryPrice - currentPrice) * position.positionSize / position.entryPrice;
          position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        }
        
        // Check for exit signals
        if (this.shouldExitPosition(position)) {
          await this.exitPosition(i);
          i--; // Adjust index after removal
        } else {
          // Update position in array
          this.positions[i] = position;
        }
      } catch (error) {
        logger.error(`Error updating position for ${position.tokenSymbol}: ${error.message}`);
      }
    }
  }
  
  // Check if position should be exited
  shouldExitPosition(position) {
    // Check stop loss
    if (position.isLong) {
      if (position.currentPrice <= position.stopLossPrice) {
        logger.high(`Stop loss triggered for LONG ${position.tokenSymbol} at ${position.currentPrice}`);
        return true;
      }
    } else {
      if (position.currentPrice >= position.stopLossPrice) {
        logger.high(`Stop loss triggered for SHORT ${position.tokenSymbol} at ${position.currentPrice}`);
        return true;
      }
    }
    
    // Check take profit
    if (position.isLong) {
      if (position.currentPrice >= position.takeProfitPrice) {
        logger.high(`Take profit triggered for LONG ${position.tokenSymbol} at ${position.currentPrice}`);
        return true;
      }
    } else {
      if (position.currentPrice <= position.takeProfitPrice) {
        logger.high(`Take profit triggered for SHORT ${position.tokenSymbol} at ${position.currentPrice}`);
        return true;
      }
    }
    
    // Check maximum holding period
    if (Date.now() - position.entryTime > this.parameters.maxHoldingPeriod) {
      logger.high(`Maximum holding period reached for ${position.tokenSymbol}`);
      return true;
    }
    
    // Check for mean reversion completion (price returns to moving average)
    const tokenData = this.monitoredTokens.get(position.tokenAddress);
    if (tokenData && tokenData.priceHistory.length > 0) {
      const lookbackPeriods = Math.min(
        Math.floor(this.parameters.lookbackPeriod * 60 * 60 * 1000 / 
          ((Date.now() - tokenData.priceHistory[0].timestamp) / tokenData.priceHistory.length)),
        tokenData.priceHistory.length
      );
      
      const ma = this.calculateMA(tokenData.priceHistory, lookbackPeriods);
      if (ma !== null) {
        const currentPrice = position.currentPrice;
        const deviation = Math.abs(currentPrice - ma) / ma;
        
        // Exit if price has returned close to the moving average (reversion complete)
        if (deviation < 0.03) { // 3% threshold
          logger.high(`Mean reversion complete for ${position.tokenSymbol}, price returned to moving average`);
          return true;
        }
      }
    }
    
    return false;
  }
  
  // Exit position
  async exitPosition(positionIndex) {
    const position = this.positions[positionIndex];
    
    // Calculate P&L based on long/short
    let exitValue, pnl, pnlPercent;
    
    if (position.isLong) {
      exitValue = position.positionSize * (position.currentPrice / position.entryPrice);
      pnl = exitValue - position.positionSize;
      pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      exitValue = position.positionSize * (2 - (position.currentPrice / position.entryPrice));
      pnl = exitValue - position.positionSize;
      pnlPercent = ((position.entryPrice - position.currentPrice) / position.entryPrice) * 100;
    }
    
    // Record trade
    const trade = {
      tokenAddress: position.tokenAddress,
      tokenSymbol: position.tokenSymbol,
      entryPrice: position.entryPrice,
      exitPrice: position.currentPrice,
      entryTime: position.entryTime,
      exitTime: Date.now(),
      positionSize: position.positionSize,
      entryValue: position.positionSize,
      exitValue,
      pnl,
      pnlPercent,
      isLong: position.isLong,
      holdingPeriod: Date.now() - position.entryTime,
      success: true,
      portfolioValueAfterTrade: position.portfolioValueBeforeTrade + pnl
    };
    
    this.recordTrade(trade);
    
    logger.high(`Exited ${position.isLong ? 'LONG' : 'SHORT'} position for ${position.tokenSymbol} with P&L: ${pnl} (${pnlPercent.toFixed(2)}%)`);
    
    // Remove position from array
    this.positions.splice(positionIndex, 1);
  }
  
  // Execute strategy
  async execute() {
    if (!this.active) {
      logger.high('Mean Reversion Strategy is not active');
      return;
    }
    
    try {
      // Discover new tokens periodically
      if (this.monitoredTokens.size < 10) {
        await this.discoverTokens();
      }
      
      // Update token data
      await this.updateTokenData();
      
      // Update existing positions
      await this.updatePositions();
      
      // Check for new entry signals
      await this.checkEntrySignals();
      
      // Clean up monitored tokens (remove tokens that no longer meet criteria)
      this.cleanupMonitoredTokens();
      
      // Log current status
      this.logStatus();
    } catch (error) {
      logger.error(`Error executing Mean Reversion Strategy: ${error.message}`);
    }
  }
  
  // Clean up monitored tokens
  cleanupMonitoredTokens() {
    for (const [address, tokenData] of this.monitoredTokens.entries()) {
      // Remove tokens that haven't been updated in 2 hours
      if (Date.now() - tokenData.lastUpdated > 2 * 60 * 60 * 1000) {
        this.monitoredTokens.delete(address);
        continue;
      }
      
      // Remove tokens that no longer meet criteria
      if (tokenData.analysis && !this.meetsInitialCriteria(tokenData.analysis)) {
        // Keep if we have an open position
        if (!this.positions.some(p => p.tokenAddress === address)) {
          this.monitoredTokens.delete(address);
        }
      }
    }
  }
  
  // Log current status
  logStatus() {
    logger.high(`Mean Reversion Strategy Status:`);
    logger.high(`- Monitored Tokens: ${this.monitoredTokens.size}`);
    logger.high(`- Open Positions: ${this.positions.length}`);
    logger.high(`- Total Trades: ${this.metrics.totalTrades}`);
    logger.high(`- Win Rate: ${(this.metrics.winRate * 100).toFixed(2)}%`);
    logger.high(`- Net P&L: ${this.metrics.netProfitLoss.toFixed(4)}`);
    
    // Log open positions
    if (this.positions.length > 0) {
      logger.high('Open Positions:');
      for (const position of this.positions) {
        logger.high(`  ${position.tokenSymbol} (${position.isLong ? 'LONG' : 'SHORT'}): Entry: ${position.entryPrice}, Current: ${position.currentPrice}, P&L: ${position.unrealizedPnlPercent.toFixed(2)}%`);
      }
    }
  }
}

module.exports = new MeanReversionStrategy();
