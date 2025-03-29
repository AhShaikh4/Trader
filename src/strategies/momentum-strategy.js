// Momentum Trading Strategy
const StrategyBase = require('./strategy-base');
const logger = require('../logger');
const fetchAnalyze = require('../fetchanalyze');
const pricePrediction = require('../price-prediction');
const jupiter = require('../jupiter');
const wallet = require('../wallet');

class MomentumStrategy extends StrategyBase {
  constructor() {
    super('Momentum Strategy');
    
    // Strategy-specific parameters
    this.parameters = {
      minTokenScore: 7.0,           // Minimum token score to consider (0-10)
      minPriceChangeH1: 3.0,        // Minimum 1-hour price change percentage
      minVolumeToLiquidityRatio: 0.1, // Minimum volume/liquidity ratio
      minLiquidityUsd: 10000,       // Minimum liquidity in USD
      maxLiquidityUsd: 500000,      // Maximum liquidity in USD
      entryConfirmationPeriod: 10,  // Minutes to confirm trend before entry
      profitTarget: 0.15,           // 15% profit target
      stopLoss: 0.07,               // 7% stop loss
      trailingStopActivation: 0.1,  // Activate trailing stop after 10% profit
      trailingStopDistance: 0.05,   // 5% trailing stop distance
      maxHoldingPeriod: 24 * 60 * 60 * 1000, // 24 hours maximum holding time
      positionSizePercent: 0.05     // 5% of available capital per trade
    };
    
    // Override base risk parameters
    this.riskParameters.maxPositionSize = 0.05;
    this.riskParameters.stopLossPercentage = 0.07;
    this.riskParameters.takeProfitPercentage = 0.15;
    
    // Track current positions
    this.positions = [];
    
    // Track tokens being monitored
    this.monitoredTokens = new Map();
  }
  
  // Initialize strategy
  async initialize() {
    await super.initialize();
    logger.high('Momentum Strategy initialized');
    
    // Initial token discovery
    await this.discoverTokens();
    
    return true;
  }
  
  // Discover potential tokens
  async discoverTokens() {
    try {
      logger.high('Discovering potential tokens for momentum strategy');
      
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
          logger.high(`Token ${token.baseToken?.symbol} (${token.baseToken?.address}) meets initial criteria`);
          
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
      
      logger.high(`Now monitoring ${this.monitoredTokens.size} tokens for momentum strategy`);
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
    
    // Check price change
    const priceChangeH1 = mainPool.priceChange?.h1 || 0;
    if (priceChangeH1 < this.parameters.minPriceChangeH1) {
      return false;
    }
    
    // Check volume to liquidity ratio
    const volume = mainPool.volume?.h24 || 0;
    const vlr = volume / liquidity;
    if (vlr < this.parameters.minVolumeToLiquidityRatio) {
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
          
          // Keep only last 24 hours of price history
          const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
          tokenData.priceHistory = tokenData.priceHistory.filter(p => p.timestamp >= oneDayAgo);
        }
        
        this.monitoredTokens.set(address, tokenData);
      } catch (error) {
        logger.error(`Error updating token ${address}: ${error.message}`);
      }
    }
  }
  
  // Check for entry signals
  async checkEntrySignals() {
    for (const [address, tokenData] of this.monitoredTokens.entries()) {
      try {
        // Skip if we don't have enough price history
        if (tokenData.priceHistory.length < 3) {
          continue;
        }
        
        // Check if we already have a position for this token
        if (this.positions.some(p => p.tokenAddress === address)) {
          continue;
        }
        
        // Check for momentum signal
        if (this.hasMomentumSignal(tokenData)) {
          logger.high(`Momentum signal detected for ${tokenData.symbol} (${address})`);
          
          // Check risk parameters
          const balance = await wallet.getBalance();
          const positionSize = this.calculatePositionSize(balance * 1e9, this.parameters.positionSizePercent);
          
          const trade = {
            tokenAddress: address,
            tokenSymbol: tokenData.symbol,
            entryPrice: tokenData.priceHistory[tokenData.priceHistory.length - 1].price,
            positionSize,
            entryTime: Date.now(),
            stopLossPrice: this.calculateStopLoss(tokenData.priceHistory[tokenData.priceHistory.length - 1].price),
            takeProfitPrice: this.calculateTakeProfit(tokenData.priceHistory[tokenData.priceHistory.length - 1].price),
            trailingStopActivated: false,
            trailingStopPrice: null,
            totalCapital: balance * 1e9,
            portfolioValueBeforeTrade: balance * 1e9
          };
          
          if (this.meetsRiskCriteria(trade)) {
            // Paper trade - simulate entry
            logger.high(`Entering position for ${tokenData.symbol} at ${trade.entryPrice}`);
            
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
  
  // Check for momentum signal
  hasMomentumSignal(tokenData) {
    // Get price history
    const priceHistory = tokenData.priceHistory;
    
    // Need at least 3 price points
    if (priceHistory.length < 3) {
      return false;
    }
    
    // Check for upward momentum
    const currentPrice = priceHistory[priceHistory.length - 1].price;
    const prevPrice = priceHistory[priceHistory.length - 2].price;
    const prevPrevPrice = priceHistory[priceHistory.length - 3].price;
    
    // Check for consecutive higher lows
    const isUptrend = currentPrice > prevPrice && prevPrice > prevPrevPrice;
    
    // Calculate recent price change
    const recentChangePercent = ((currentPrice - prevPrice) / prevPrice) * 100;
    
    // Check volume if available
    let volumeIncreasing = false;
    if (tokenData.analysis && 
        tokenData.analysis.dexscreener && 
        tokenData.analysis.dexscreener.pools && 
        tokenData.analysis.dexscreener.pools.length > 0) {
      
      const pool = tokenData.analysis.dexscreener.pools[0];
      if (pool.volume && pool.volume.h1 && pool.volume.h6) {
        // Check if hourly volume is higher than average 6-hour volume
        volumeIncreasing = pool.volume.h1 > (pool.volume.h6 / 6);
      }
    }
    
    // Combine signals
    return isUptrend && recentChangePercent >= this.parameters.minPriceChangeH1 && volumeIncreasing;
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
        
        // Calculate unrealized P&L
        position.unrealizedPnl = (currentPrice - position.entryPrice) * position.positionSize / position.entryPrice;
        position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        
        // Check for exit signals
        if (this.shouldExitPosition(position)) {
          await this.exitPosition(i);
          i--; // Adjust index after removal
        } else {
          // Update trailing stop if needed
          this.updateTrailingStop(position);
          
          // Update position in array
          this.positions[i] = position;
        }
      } catch (error) {
        logger.error(`Error updating position for ${position.tokenSymbol}: ${error.message}`);
      }
    }
  }
  
  // Update trailing stop
  updateTrailingStop(position) {
    // Check if trailing stop should be activated
    if (!position.trailingStopActivated && 
        position.unrealizedPnlPercent >= this.parameters.trailingStopActivation * 100) {
      
      position.trailingStopActivated = true;
      position.trailingStopPrice = position.currentPrice * (1 - this.parameters.trailingStopDistance);
      
      logger.high(`Trailing stop activated for ${position.tokenSymbol} at ${position.trailingStopPrice}`);
    }
    
    // Update trailing stop price if price moves up
    if (position.trailingStopActivated) {
      const newTrailingStop = position.currentPrice * (1 - this.parameters.trailingStopDistance);
      
      if (newTrailingStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
        logger.deep(`Trailing stop updated for ${position.tokenSymbol} to ${position.trailingStopPrice}`);
      }
    }
  }
  
  // Check if position should be exited
  shouldExitPosition(position) {
    // Check stop loss
    if (position.currentPrice <= position.stopLossPrice) {
      logger.high(`Stop loss triggered for ${position.tokenSymbol} at ${position.currentPrice}`);
      return true;
    }
    
    // Check take profit
    if (position.currentPrice >= position.takeProfitPrice) {
      logger.high(`Take profit triggered for ${position.tokenSymbol} at ${position.currentPrice}`);
      return true;
    }
    
    // Check trailing stop
    if (position.trailingStopActivated && position.currentPrice <= position.trailingStopPrice) {
      logger.high(`Trailing stop triggered for ${position.tokenSymbol} at ${position.currentPrice}`);
      return true;
    }
    
    // Check maximum holding period
    if (Date.now() - position.entryTime > this.parameters.maxHoldingPeriod) {
      logger.high(`Maximum holding period reached for ${position.tokenSymbol}`);
      return true;
    }
    
    return false;
  }
  
  // Exit position
  async exitPosition(positionIndex) {
    const position = this.positions[positionIndex];
    
    // Calculate P&L
    const exitValue = position.positionSize * (position.currentPrice / position.entryPrice);
    const pnl = exitValue - position.positionSize;
    const pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
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
      holdingPeriod: Date.now() - position.entryTime,
      success: true,
      portfolioValueAfterTrade: position.portfolioValueBeforeTrade + pnl
    };
    
    this.recordTrade(trade);
    
    logger.high(`Exited position for ${position.tokenSymbol} with P&L: ${pnl} (${pnlPercent.toFixed(2)}%)`);
    
    // Remove position from array
    this.positions.splice(positionIndex, 1);
  }
  
  // Execute strategy
  async execute() {
    if (!this.active) {
      logger.high('Momentum Strategy is not active');
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
      logger.error(`Error executing Momentum Strategy: ${error.message}`);
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
    logger.high(`Momentum Strategy Status:`);
    logger.high(`- Monitored Tokens: ${this.monitoredTokens.size}`);
    logger.high(`- Open Positions: ${this.positions.length}`);
    logger.high(`- Total Trades: ${this.metrics.totalTrades}`);
    logger.high(`- Win Rate: ${(this.metrics.winRate * 100).toFixed(2)}%`);
    logger.high(`- Net P&L: ${this.metrics.netProfitLoss.toFixed(4)}`);
    
    // Log open positions
    if (this.positions.length > 0) {
      logger.high('Open Positions:');
      for (const position of this.positions) {
        logger.high(`  ${position.tokenSymbol}: Entry: ${position.entryPrice}, Current: ${position.currentPrice}, P&L: ${position.unrealizedPnlPercent.toFixed(2)}%`);
      }
    }
  }
}

module.exports = new MomentumStrategy();
