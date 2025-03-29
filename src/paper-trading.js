// Paper Trading System
const logger = require('./logger');
const fetchAnalyze = require('./fetchanalyze');
const wallet = require('./wallet');
const fs = require('fs');
const path = require('path');

// Import strategies
const momentumStrategy = require('./strategies/momentum-strategy');
const meanReversionStrategy = require('./strategies/mean-reversion-strategy');

class PaperTradingSystem {
  constructor() {
    this.strategies = [];
    this.isRunning = false;
    this.startTime = null;
    this.initialBalance = 0;
    this.currentBalance = 0;
    this.executionInterval = 15 * 60 * 1000; // 15 minutes
    this.lastExecutionTime = 0;
    this.resultsDir = path.join(__dirname, '../results');
    this.dataDir = path.join(__dirname, '../data');
    
    // Ensure directories exist
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }
  
  // Initialize the paper trading system
  async initialize(initialBalanceSol = 10) {
    try {
      logger.high('Initializing Paper Trading System');
      
      // Initialize wallet
      const walletInitialized = wallet.initialize();
      if (!walletInitialized) {
        throw new Error('Failed to initialize wallet');
      }
      
      // Get actual wallet balance if available, otherwise use provided initial balance
      let actualBalance = await wallet.getBalance();
      this.initialBalance = actualBalance || initialBalanceSol;
      this.currentBalance = this.initialBalance;
      
      logger.high(`Paper Trading System initialized with ${this.initialBalance} SOL`);
      
      // Register strategies
      this.registerStrategy(momentumStrategy);
      this.registerStrategy(meanReversionStrategy);
      
      // Initialize all strategies
      for (const strategy of this.strategies) {
        await strategy.initialize();
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Paper Trading System: ${error.message}`);
      return false;
    }
  }
  
  // Register a strategy
  registerStrategy(strategy) {
    this.strategies.push(strategy);
    logger.high(`Registered strategy: ${strategy.name}`);
  }
  
  // Start paper trading
  async start() {
    if (this.isRunning) {
      logger.high('Paper Trading System is already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    logger.high('Paper Trading System started');
    
    // Execute strategies immediately on start
    await this.executeStrategies();
    
    // Set up interval for regular execution
    this.executionInterval = setInterval(async () => {
      await this.executeStrategies();
    }, this.executionInterval);
  }
  
  // Stop paper trading
  async stop() {
    if (!this.isRunning) {
      logger.high('Paper Trading System is not running');
      return;
    }
    
    clearInterval(this.executionInterval);
    this.isRunning = false;
    
    // Stop all strategies
    for (const strategy of this.strategies) {
      await strategy.stop();
    }
    
    logger.high('Paper Trading System stopped');
    
    // Generate final report
    await this.generatePerformanceReport();
  }
  
  // Execute all strategies
  async executeStrategies() {
    if (!this.isRunning) {
      return;
    }
    
    const now = Date.now();
    this.lastExecutionTime = now;
    
    logger.high(`Executing strategies at ${new Date(now).toISOString()}`);
    
    for (const strategy of this.strategies) {
      try {
        await strategy.execute();
      } catch (error) {
        logger.error(`Error executing strategy ${strategy.name}: ${error.message}`);
      }
    }
    
    // Update system balance based on strategy performance
    this.updateSystemBalance();
    
    // Save intermediate results
    this.saveIntermediateResults();
  }
  
  // Update system balance based on strategy performance
  updateSystemBalance() {
    let totalPnL = 0;
    
    for (const strategy of this.strategies) {
      totalPnL += strategy.metrics.netProfitLoss;
    }
    
    this.currentBalance = this.initialBalance + totalPnL;
    
    logger.high(`Updated system balance: ${this.currentBalance.toFixed(4)} SOL (${((this.currentBalance / this.initialBalance - 1) * 100).toFixed(2)}% change)`);
  }
  
  // Save intermediate results
  saveIntermediateResults() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const resultsFile = path.join(this.resultsDir, `results_${timestamp}.json`);
      
      const results = {
        timestamp: Date.now(),
        runningTime: Date.now() - this.startTime,
        initialBalance: this.initialBalance,
        currentBalance: this.currentBalance,
        percentageChange: ((this.currentBalance / this.initialBalance - 1) * 100),
        strategies: this.strategies.map(strategy => strategy.getPerformanceReport())
      };
      
      fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
      logger.high(`Saved intermediate results to ${resultsFile}`);
    } catch (error) {
      logger.error(`Failed to save intermediate results: ${error.message}`);
    }
  }
  
  // Generate performance report
  async generatePerformanceReport() {
    try {
      const reportFile = path.join(this.resultsDir, 'performance_report.json');
      
      const report = {
        generatedAt: new Date().toISOString(),
        runDuration: Date.now() - this.startTime,
        initialBalance: this.initialBalance,
        finalBalance: this.currentBalance,
        totalReturn: ((this.currentBalance / this.initialBalance - 1) * 100),
        strategies: []
      };
      
      // Add strategy-specific reports
      for (const strategy of this.strategies) {
        const strategyReport = strategy.getPerformanceReport();
        
        // Add additional metrics
        strategyReport.annualizedReturn = this.calculateAnnualizedReturn(
          strategyReport.metrics.netProfitLoss,
          this.initialBalance / this.strategies.length,
          report.runDuration
        );
        
        strategyReport.sharpeRatio = this.calculateSharpeRatio(
          strategy.trades,
          strategyReport.metrics.netProfitLoss,
          this.initialBalance / this.strategies.length
        );
        
        report.strategies.push(strategyReport);
      }
      
      // Calculate system-wide metrics
      report.bestStrategy = this.findBestStrategy();
      report.worstStrategy = this.findWorstStrategy();
      report.systemSharpeRatio = this.calculateSystemSharpeRatio();
      report.maxDrawdown = this.calculateMaxDrawdown();
      
      // Save report
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      logger.high(`Generated performance report: ${reportFile}`);
      
      // Generate CSV trade log
      this.generateTradeLog();
      
      return report;
    } catch (error) {
      logger.error(`Failed to generate performance report: ${error.message}`);
      return null;
    }
  }
  
  // Calculate annualized return
  calculateAnnualizedReturn(profit, investment, durationMs) {
    const durationYears = durationMs / (365 * 24 * 60 * 60 * 1000);
    if (durationYears === 0) return 0;
    
    const totalReturn = profit / investment;
    return Math.pow(1 + totalReturn, 1 / durationYears) - 1;
  }
  
  // Calculate Sharpe ratio
  calculateSharpeRatio(trades, totalProfit, investment) {
    if (trades.length < 2) return 0;
    
    // Calculate daily returns
    const dailyReturns = [];
    const tradesByDay = new Map();
    
    for (const trade of trades) {
      const date = new Date(trade.exitTime).toISOString().split('T')[0];
      if (!tradesByDay.has(date)) {
        tradesByDay.set(date, []);
      }
      tradesByDay.get(date).push(trade);
    }
    
    for (const [date, dayTrades] of tradesByDay.entries()) {
      const dayProfit = dayTrades.reduce((sum, trade) => sum + trade.pnl, 0);
      const dayReturn = dayProfit / investment;
      dailyReturns.push(dayReturn);
    }
    
    // Calculate average return and standard deviation
    const avgReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate Sharpe ratio (assuming risk-free rate of 0)
    return stdDev === 0 ? 0 : (avgReturn / stdDev) * Math.sqrt(252); // Annualized
  }
  
  // Calculate system-wide Sharpe ratio
  calculateSystemSharpeRatio() {
    // Combine all trades from all strategies
    const allTrades = [];
    for (const strategy of this.strategies) {
      allTrades.push(...strategy.trades);
    }
    
    return this.calculateSharpeRatio(
      allTrades,
      this.currentBalance - this.initialBalance,
      this.initialBalance
    );
  }
  
  // Calculate maximum drawdown
  calculateMaxDrawdown() {
    let maxDrawdown = 0;
    let peak = this.initialBalance;
    
    // Get all intermediate results files
    const resultFiles = fs.readdirSync(this.resultsDir)
      .filter(file => file.startsWith('results_'))
      .map(file => path.join(this.resultsDir, file));
    
    // Sort by timestamp
    resultFiles.sort();
    
    for (const file of resultFiles) {
      try {
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        const balance = result.currentBalance;
        
        if (balance > peak) {
          peak = balance;
        } else {
          const drawdown = (peak - balance) / peak;
          if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
          }
        }
      } catch (error) {
        logger.error(`Error processing result file ${file}: ${error.message}`);
      }
    }
    
    return maxDrawdown;
  }
  
  // Find best performing strategy
  findBestStrategy() {
    if (this.strategies.length === 0) {
      return null;
    }
    
    let bestStrategy = this.strategies[0];
    let bestReturn = bestStrategy.metrics.netProfitLoss;
    
    for (let i = 1; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      if (strategy.metrics.netProfitLoss > bestReturn) {
        bestStrategy = strategy;
        bestReturn = strategy.metrics.netProfitLoss;
      }
    }
    
    return {
      name: bestStrategy.name,
      netProfitLoss: bestReturn,
      returnPercentage: (bestReturn / (this.initialBalance / this.strategies.length)) * 100
    };
  }
  
  // Find worst performing strategy
  findWorstStrategy() {
    if (this.strategies.length === 0) {
      return null;
    }
    
    let worstStrategy = this.strategies[0];
    let worstReturn = worstStrategy.metrics.netProfitLoss;
    
    for (let i = 1; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      if (strategy.metrics.netProfitLoss < worstReturn) {
        worstStrategy = strategy;
        worstReturn = strategy.metrics.netProfitLoss;
      }
    }
    
    return {
      name: worstStrategy.name,
      netProfitLoss: worstReturn,
      returnPercentage: (worstReturn / (this.initialBalance / this.strategies.length)) * 100
    };
  }
  
  // Generate CSV trade log
  generateTradeLog() {
    try {
      const logFile = path.join(this.resultsDir, 'trade_log.csv');
      
      // Create CSV header
      let csv = 'Strategy,TokenSymbol,TokenAddress,EntryTime,ExitTime,EntryPrice,ExitPrice,PositionSize,PnL,PnLPercent,Direction,HoldingPeriodHours\n';
      
      // Add all trades
      for (const strategy of this.strategies) {
        for (const trade of strategy.trades) {
          const holdingPeriodHours = (trade.exitTime - trade.entryTime) / (60 * 60 * 1000);
          const direction = trade.isLong !== undefined ? (trade.isLong ? 'LONG' : 'SHORT') : 'LONG';
          
          csv += `${strategy.name},${trade.tokenSymbol},${trade.tokenAddress},`;
          csv += `${new Date(trade.entryTime).toISOString()},${new Date(trade.exitTime).toISOString()},`;
          csv += `${trade.entryPrice},${trade.exitPrice},${trade.positionSize},`;
          csv += `${trade.pnl},${trade.pnlPercent.toFixed(2)},${direction},${holdingPeriodHours.toFixed(2)}\n`;
        }
      }
      
      fs.writeFileSync(logFile, csv);
      logger.high(`Generated trade log: ${logFile}`);
    } catch (error) {
      logger.error(`Failed to generate trade log: ${error.message}`);
    }
  }
  
  // Get system status
  getStatus() {
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      runningTime: this.startTime ? Date.now() - this.startTime : 0,
      initialBalance: this.initialBalance,
      currentBalance: this.currentBalance,
      percentageChange: ((this.currentBalance / this.initialBalance - 1) * 100),
      lastExecutionTime: this.lastExecutionTime,
      strategies: this.strategies.map(strategy => ({
        name: strategy.name,
        active: strategy.active,
        totalTrades: strategy.metrics.totalTrades,
        openPositions: strategy.positions ? strategy.positions.length : 0,
        netProfitLoss: strategy.metrics.netProfitLoss,
        winRate: strategy.metrics.winRate
      }))
    };
  }
}

module.exports = new PaperTradingSystem();
