// Main entry point for paper trading test
const logger = require('./logger');
const paperTrading = require('./paper-trading');
const fetchAnalyze = require('./fetchanalyze');
const moralis = require('./moralis');

// Test duration in milliseconds (default: 24 hours)
const TEST_DURATION = 24 * 60 * 60 * 1000;

// Initial paper trading balance in SOL
const INITIAL_BALANCE = 10;

async function runPaperTradingTest() {
  try {
    logger.high('Starting paper trading test');
    
    // Initialize Moralis
    await moralis.initMoralis();
    
    // Initialize paper trading system
    const initialized = await paperTrading.initialize(INITIAL_BALANCE);
    if (!initialized) {
      throw new Error('Failed to initialize paper trading system');
    }
    
    // Start paper trading
    await paperTrading.start();
    
    // Log initial status
    logStatus();
    
    // Set up status logging interval (every hour)
    const statusInterval = setInterval(() => {
      logStatus();
    }, 60 * 60 * 1000);
    
    // Set up test duration timeout
    setTimeout(async () => {
      clearInterval(statusInterval);
      
      // Stop paper trading
      await paperTrading.stop();
      
      // Generate final report
      const report = await paperTrading.generatePerformanceReport();
      
      logger.high('Paper trading test completed');
      logger.high(`Final balance: ${report.finalBalance.toFixed(4)} SOL (${report.totalReturn.toFixed(2)}% return)`);
      logger.high(`Best strategy: ${report.bestStrategy.name} (${report.bestStrategy.returnPercentage.toFixed(2)}% return)`);
      logger.high(`Worst strategy: ${report.worstStrategy.name} (${report.worstStrategy.returnPercentage.toFixed(2)}% return)`);
      logger.high(`System Sharpe ratio: ${report.systemSharpeRatio.toFixed(4)}`);
      logger.high(`Maximum drawdown: ${(report.maxDrawdown * 100).toFixed(2)}%`);
      
      // Log detailed report location
      logger.high(`Detailed performance report saved to: ${__dirname}/../results/performance_report.json`);
      logger.high(`Trade log saved to: ${__dirname}/../results/trade_log.csv`);
    }, TEST_DURATION);
    
  } catch (error) {
    logger.error(`Error running paper trading test: ${error.message}`);
  }
}

// Log current status
function logStatus() {
  const status = paperTrading.getStatus();
  
  logger.high('=== Paper Trading Status ===');
  logger.high(`Running time: ${formatDuration(status.runningTime)}`);
  logger.high(`Current balance: ${status.currentBalance.toFixed(4)} SOL (${status.percentageChange.toFixed(2)}% change)`);
  
  logger.high('Strategy status:');
  for (const strategy of status.strategies) {
    logger.high(`- ${strategy.name}: ${strategy.totalTrades} trades, ${strategy.openPositions} open positions, ${strategy.netProfitLoss.toFixed(4)} SOL P&L, ${(strategy.winRate * 100).toFixed(2)}% win rate`);
  }
  logger.high('============================');
}

// Format duration in milliseconds to human-readable format
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

// Run the test
runPaperTradingTest();

module.exports = { runPaperTradingTest };
