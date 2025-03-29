// Base class for all trading strategies
const logger = require('../logger');

class StrategyBase {
  constructor(name) {
    this.name = name;
    this.trades = [];
    this.active = false;
    this.startTime = null;
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      profitableTrades: 0,
      unprofitableTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfitLoss: 0,
      winRate: 0,
      averageProfit: 0,
      averageLoss: 0,
      largestProfit: 0,
      largestLoss: 0,
      profitFactor: 0
    };
    this.riskParameters = {
      maxPositionSize: 0.1, // 10% of available capital
      stopLossPercentage: 0.05, // 5% stop loss
      takeProfitPercentage: 0.1, // 10% take profit
      maxOpenTrades: 3, // Maximum number of concurrent trades
      maxDailyLoss: 0.05, // Maximum 5% daily loss
      maxDrawdown: 0.15 // Maximum 15% drawdown
    };
  }

  // Initialize the strategy
  async initialize() {
    this.active = true;
    this.startTime = Date.now();
    logger.high(`Strategy ${this.name} initialized`);
    return true;
  }

  // Stop the strategy
  async stop() {
    this.active = false;
    logger.high(`Strategy ${this.name} stopped`);
    return true;
  }

  // Execute the strategy
  async execute() {
    throw new Error('Execute method must be implemented by derived strategy classes');
  }

  // Record a trade
  recordTrade(trade) {
    this.trades.push({
      ...trade,
      timestamp: Date.now()
    });
    
    // Update metrics
    this.updateMetrics(trade);
    
    logger.high(`Trade recorded for ${this.name}: ${JSON.stringify(trade)}`);
  }

  // Update strategy metrics
  updateMetrics(trade) {
    this.metrics.totalTrades++;
    
    if (trade.success) {
      this.metrics.successfulTrades++;
    } else {
      this.metrics.failedTrades++;
      return; // Don't update profit/loss metrics for failed trades
    }
    
    const profitLoss = trade.exitValue - trade.entryValue;
    
    if (profitLoss > 0) {
      this.metrics.profitableTrades++;
      this.metrics.totalProfit += profitLoss;
      
      if (profitLoss > this.metrics.largestProfit) {
        this.metrics.largestProfit = profitLoss;
      }
    } else {
      this.metrics.unprofitableTrades++;
      this.metrics.totalLoss += Math.abs(profitLoss);
      
      if (Math.abs(profitLoss) > this.metrics.largestLoss) {
        this.metrics.largestLoss = Math.abs(profitLoss);
      }
    }
    
    this.metrics.netProfitLoss = this.metrics.totalProfit - this.metrics.totalLoss;
    
    // Calculate win rate
    this.metrics.winRate = this.metrics.profitableTrades / this.metrics.totalTrades;
    
    // Calculate average profit and loss
    if (this.metrics.profitableTrades > 0) {
      this.metrics.averageProfit = this.metrics.totalProfit / this.metrics.profitableTrades;
    }
    
    if (this.metrics.unprofitableTrades > 0) {
      this.metrics.averageLoss = this.metrics.totalLoss / this.metrics.unprofitableTrades;
    }
    
    // Calculate profit factor
    if (this.metrics.totalLoss > 0) {
      this.metrics.profitFactor = this.metrics.totalProfit / this.metrics.totalLoss;
    }
  }

  // Get strategy performance report
  getPerformanceReport() {
    return {
      name: this.name,
      active: this.active,
      runningTime: Date.now() - this.startTime,
      metrics: this.metrics,
      riskParameters: this.riskParameters
    };
  }

  // Check if a trade meets risk management criteria
  meetsRiskCriteria(trade) {
    // Check if we already have maximum number of open trades
    const openTrades = this.trades.filter(t => !t.closed);
    if (openTrades.length >= this.riskParameters.maxOpenTrades) {
      logger.deep(`Maximum open trades reached for ${this.name}`);
      return false;
    }
    
    // Check if position size exceeds maximum
    if (trade.positionSize > this.riskParameters.maxPositionSize) {
      logger.deep(`Position size exceeds maximum for ${this.name}`);
      return false;
    }
    
    // Check daily loss limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayTrades = this.trades.filter(t => 
      t.timestamp >= todayStart.getTime() && 
      t.success && 
      t.exitValue < t.entryValue
    );
    
    const todayLoss = todayTrades.reduce((total, t) => 
      total + (t.entryValue - t.exitValue), 0
    );
    
    const totalCapital = trade.totalCapital || 1000; // Default if not provided
    
    if (todayLoss / totalCapital > this.riskParameters.maxDailyLoss) {
      logger.deep(`Daily loss limit reached for ${this.name}`);
      return false;
    }
    
    // Check drawdown
    const highWaterMark = Math.max(
      ...this.trades.map(t => t.portfolioValueAfterTrade || 0),
      totalCapital
    );
    
    const currentValue = trade.portfolioValueBeforeTrade || totalCapital;
    const drawdown = (highWaterMark - currentValue) / highWaterMark;
    
    if (drawdown > this.riskParameters.maxDrawdown) {
      logger.deep(`Maximum drawdown reached for ${this.name}`);
      return false;
    }
    
    return true;
  }

  // Calculate position size based on risk
  calculatePositionSize(totalCapital, riskPerTrade = 0.01) {
    // Default risk per trade is 1% of capital
    return totalCapital * Math.min(riskPerTrade, this.riskParameters.maxPositionSize);
  }

  // Calculate stop loss price
  calculateStopLoss(entryPrice, isLong = true) {
    if (isLong) {
      return entryPrice * (1 - this.riskParameters.stopLossPercentage);
    } else {
      return entryPrice * (1 + this.riskParameters.stopLossPercentage);
    }
  }

  // Calculate take profit price
  calculateTakeProfit(entryPrice, isLong = true) {
    if (isLong) {
      return entryPrice * (1 + this.riskParameters.takeProfitPercentage);
    } else {
      return entryPrice * (1 - this.riskParameters.takeProfitPercentage);
    }
  }
}

module.exports = StrategyBase;
