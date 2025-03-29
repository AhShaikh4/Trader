// Strategy Analyzer and Optimizer
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

class StrategyAnalyzer {
  constructor() {
    this.resultsDir = path.join(__dirname, '../results');
    this.optimizationsDir = path.join(__dirname, '../optimizations');
    
    // Ensure directories exist
    if (!fs.existsSync(this.optimizationsDir)) {
      fs.mkdirSync(this.optimizationsDir, { recursive: true });
    }
  }
  
  // Analyze performance report and generate optimization recommendations
  analyzePerformance() {
    try {
      logger.high('Analyzing strategy performance...');
      
      // Load performance report
      const reportPath = path.join(this.resultsDir, 'performance_report.json');
      if (!fs.existsSync(reportPath)) {
        throw new Error('Performance report not found. Run paper trading test first.');
      }
      
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      
      // Load trade log
      const tradeLogPath = path.join(this.resultsDir, 'trade_log.csv');
      if (!fs.existsSync(tradeLogPath)) {
        throw new Error('Trade log not found. Run paper trading test first.');
      }
      
      const tradeLog = fs.readFileSync(tradeLogPath, 'utf8').split('\n');
      const trades = this.parseTradeLog(tradeLog);
      
      // Analyze each strategy
      const strategyAnalysis = {};
      
      for (const strategy of report.strategies) {
        const strategyTrades = trades.filter(trade => trade.strategy === strategy.name);
        strategyAnalysis[strategy.name] = this.analyzeStrategyTrades(strategy, strategyTrades);
      }
      
      // Generate optimization recommendations
      const recommendations = this.generateOptimizationRecommendations(report, strategyAnalysis);
      
      // Save analysis and recommendations
      const analysisPath = path.join(this.optimizationsDir, 'strategy_analysis.json');
      fs.writeFileSync(analysisPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        overallPerformance: {
          initialBalance: report.initialBalance,
          finalBalance: report.finalBalance,
          totalReturn: report.totalReturn,
          bestStrategy: report.bestStrategy,
          worstStrategy: report.worstStrategy,
          systemSharpeRatio: report.systemSharpeRatio,
          maxDrawdown: report.maxDrawdown
        },
        strategyAnalysis,
        recommendations
      }, null, 2));
      
      logger.high(`Strategy analysis saved to: ${analysisPath}`);
      
      return {
        strategyAnalysis,
        recommendations
      };
    } catch (error) {
      logger.error(`Error analyzing performance: ${error.message}`);
      return null;
    }
  }
  
  // Parse trade log CSV
  parseTradeLog(tradeLog) {
    const trades = [];
    
    // Skip header
    for (let i = 1; i < tradeLog.length; i++) {
      const line = tradeLog[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length < 11) continue;
      
      trades.push({
        strategy: parts[0],
        tokenSymbol: parts[1],
        tokenAddress: parts[2],
        entryTime: new Date(parts[3]),
        exitTime: new Date(parts[4]),
        entryPrice: parseFloat(parts[5]),
        exitPrice: parseFloat(parts[6]),
        positionSize: parseFloat(parts[7]),
        pnl: parseFloat(parts[8]),
        pnlPercent: parseFloat(parts[9]),
        direction: parts[10],
        holdingPeriodHours: parts.length > 11 ? parseFloat(parts[11]) : 0
      });
    }
    
    return trades;
  }
  
  // Analyze trades for a specific strategy
  analyzeStrategyTrades(strategy, trades) {
    if (trades.length === 0) {
      return {
        tradeCount: 0,
        message: 'No trades executed for this strategy'
      };
    }
    
    // Calculate metrics
    const profitableTrades = trades.filter(t => t.pnl > 0);
    const unprofitableTrades = trades.filter(t => t.pnl <= 0);
    
    const avgHoldingPeriod = trades.reduce((sum, t) => sum + t.holdingPeriodHours, 0) / trades.length;
    const avgProfitableHoldingPeriod = profitableTrades.length > 0 ? 
      profitableTrades.reduce((sum, t) => sum + t.holdingPeriodHours, 0) / profitableTrades.length : 0;
    const avgUnprofitableHoldingPeriod = unprofitableTrades.length > 0 ? 
      unprofitableTrades.reduce((sum, t) => sum + t.holdingPeriodHours, 0) / unprofitableTrades.length : 0;
    
    // Analyze by token
    const tokenPerformance = {};
    for (const trade of trades) {
      if (!tokenPerformance[trade.tokenSymbol]) {
        tokenPerformance[trade.tokenSymbol] = {
          trades: 0,
          profitable: 0,
          unprofitable: 0,
          totalPnl: 0,
          avgPnlPercent: 0
        };
      }
      
      const token = tokenPerformance[trade.tokenSymbol];
      token.trades++;
      if (trade.pnl > 0) {
        token.profitable++;
      } else {
        token.unprofitable++;
      }
      token.totalPnl += trade.pnl;
      token.avgPnlPercent = (token.avgPnlPercent * (token.trades - 1) + trade.pnlPercent) / token.trades;
    }
    
    // Sort tokens by performance
    const tokensSorted = Object.entries(tokenPerformance)
      .map(([symbol, data]) => ({
        symbol,
        ...data,
        winRate: data.profitable / data.trades
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl);
    
    const bestTokens = tokensSorted.slice(0, 3);
    const worstTokens = tokensSorted.slice(-3).reverse();
    
    // Analyze by time of day
    const hourPerformance = {};
    for (const trade of trades) {
      const hour = trade.entryTime.getUTCHours();
      if (!hourPerformance[hour]) {
        hourPerformance[hour] = {
          trades: 0,
          profitable: 0,
          unprofitable: 0,
          totalPnl: 0,
          avgPnlPercent: 0
        };
      }
      
      const hourData = hourPerformance[hour];
      hourData.trades++;
      if (trade.pnl > 0) {
        hourData.profitable++;
      } else {
        hourData.unprofitable++;
      }
      hourData.totalPnl += trade.pnl;
      hourData.avgPnlPercent = (hourData.avgPnlPercent * (hourData.trades - 1) + trade.pnlPercent) / hourData.trades;
    }
    
    // Find best and worst hours
    const hoursSorted = Object.entries(hourPerformance)
      .map(([hour, data]) => ({
        hour: parseInt(hour),
        ...data,
        winRate: data.profitable / data.trades
      }))
      .sort((a, b) => b.winRate - a.winRate);
    
    const bestHours = hoursSorted.slice(0, 3);
    const worstHours = hoursSorted.slice(-3).reverse();
    
    // Analyze by holding period
    const holdingPeriodBuckets = {
      'under1h': { trades: 0, profitable: 0, totalPnl: 0 },
      '1to4h': { trades: 0, profitable: 0, totalPnl: 0 },
      '4to12h': { trades: 0, profitable: 0, totalPnl: 0 },
      '12to24h': { trades: 0, profitable: 0, totalPnl: 0 },
      'over24h': { trades: 0, profitable: 0, totalPnl: 0 }
    };
    
    for (const trade of trades) {
      let bucket;
      if (trade.holdingPeriodHours < 1) bucket = 'under1h';
      else if (trade.holdingPeriodHours < 4) bucket = '1to4h';
      else if (trade.holdingPeriodHours < 12) bucket = '4to12h';
      else if (trade.holdingPeriodHours < 24) bucket = '12to24h';
      else bucket = 'over24h';
      
      holdingPeriodBuckets[bucket].trades++;
      if (trade.pnl > 0) {
        holdingPeriodBuckets[bucket].profitable++;
      }
      holdingPeriodBuckets[bucket].totalPnl += trade.pnl;
    }
    
    // Calculate win rates for holding periods
    for (const [bucket, data] of Object.entries(holdingPeriodBuckets)) {
      if (data.trades > 0) {
        data.winRate = data.profitable / data.trades;
        data.avgPnl = data.totalPnl / data.trades;
      } else {
        data.winRate = 0;
        data.avgPnl = 0;
      }
    }
    
    // Return analysis
    return {
      tradeCount: trades.length,
      profitableTrades: profitableTrades.length,
      unprofitableTrades: unprofitableTrades.length,
      winRate: strategy.metrics.winRate,
      avgPnlPercent: trades.reduce((sum, t) => sum + t.pnlPercent, 0) / trades.length,
      avgHoldingPeriod,
      avgProfitableHoldingPeriod,
      avgUnprofitableHoldingPeriod,
      bestTokens,
      worstTokens,
      bestHours,
      worstHours,
      holdingPeriodAnalysis: holdingPeriodBuckets,
      tokenPerformance: tokensSorted
    };
  }
  
  // Generate optimization recommendations
  generateOptimizationRecommendations(report, strategyAnalysis) {
    const recommendations = {};
    
    for (const strategy of report.strategies) {
      const analysis = strategyAnalysis[strategy.name];
      
      if (!analysis || analysis.tradeCount === 0) {
        recommendations[strategy.name] = [{
          priority: 'high',
          parameter: 'general',
          message: 'Strategy did not execute any trades. Review token discovery criteria and entry signals.',
          currentValue: 'N/A',
          suggestedValue: 'N/A'
        }];
        continue;
      }
      
      const strategyRecommendations = [];
      
      // Analyze win rate
      if (analysis.winRate < 0.4) {
        strategyRecommendations.push({
          priority: 'high',
          parameter: 'entrySignals',
          message: 'Low win rate. Consider stricter entry criteria.',
          currentValue: `${(analysis.winRate * 100).toFixed(2)}%`,
          suggestedValue: 'Increase minimum token score and price change requirements'
        });
      }
      
      // Analyze holding periods
      const holdingPeriodAnalysis = analysis.holdingPeriodAnalysis;
      const bestHoldingPeriod = Object.entries(holdingPeriodAnalysis)
        .filter(([_, data]) => data.trades >= 3) // Require at least 3 trades for statistical significance
        .sort((a, b) => b[1].winRate - a[1].winRate)[0];
      
      if (bestHoldingPeriod) {
        const [period, data] = bestHoldingPeriod;
        
        let recommendedHoldingPeriod;
        switch (period) {
          case 'under1h': recommendedHoldingPeriod = '30-60 minutes'; break;
          case '1to4h': recommendedHoldingPeriod = '2-4 hours'; break;
          case '4to12h': recommendedHoldingPeriod = '6-8 hours'; break;
          case '12to24h': recommendedHoldingPeriod = '16-20 hours'; break;
          case 'over24h': recommendedHoldingPeriod = '24-36 hours'; break;
        }
        
        strategyRecommendations.push({
          priority: 'medium',
          parameter: 'maxHoldingPeriod',
          message: `Optimal holding period identified: ${period} (${(data.winRate * 100).toFixed(2)}% win rate)`,
          currentValue: `${strategy.parameters?.maxHoldingPeriod ? (strategy.parameters.maxHoldingPeriod / (60 * 60 * 1000)).toFixed(0) + ' hours' : 'unknown'}`,
          suggestedValue: recommendedHoldingPeriod
        });
      }
      
      // Analyze best performing tokens
      if (analysis.bestTokens.length > 0) {
        const tokenTypes = analysis.bestTokens.map(t => t.symbol).join(', ');
        strategyRecommendations.push({
          priority: 'medium',
          parameter: 'tokenFiltering',
          message: `Best performing tokens: ${tokenTypes}. Consider focusing on similar tokens.`,
          currentValue: 'General token criteria',
          suggestedValue: 'Add specific token type filtering'
        });
      }
      
      // Analyze best hours
      if (analysis.bestHours.length > 0 && analysis.bestHours[0].winRate > 0.6) {
        const hours = analysis.bestHours.map(h => `${h.hour}:00 UTC (${(h.winRate * 100).toFixed(0)}%)`).join(', ');
        strategyRecommendations.push({
          priority: 'medium',
          parameter: 'tradingHours',
          message: `Best performing hours: ${hours}`,
          currentValue: '24/7 trading',
          suggestedValue: 'Limit trading to optimal hours'
        });
      }
      
      // Strategy-specific recommendations
      if (strategy.name.includes('Momentum')) {
        // Momentum strategy specific recommendations
        if (analysis.avgProfitableHoldingPeriod < analysis.avgUnprofitableHoldingPeriod) {
          strategyRecommendations.push({
            priority: 'high',
            parameter: 'trailingStopActivation',
            message: 'Profitable trades have shorter holding periods. Consider earlier trailing stop activation.',
            currentValue: strategy.parameters?.trailingStopActivation || 'unknown',
            suggestedValue: '0.05-0.08 (5-8%)'
          });
        }
        
        if (analysis.avgPnlPercent < 5) {
          strategyRecommendations.push({
            priority: 'medium',
            parameter: 'minPriceChangeH1',
            message: 'Low average profit. Consider increasing minimum price change requirement.',
            currentValue: strategy.parameters?.minPriceChangeH1 || 'unknown',
            suggestedValue: '5.0-7.0%'
          });
        }
      } else if (strategy.name.includes('Mean Reversion')) {
        // Mean reversion strategy specific recommendations
        if (analysis.winRate < 0.5) {
          strategyRecommendations.push({
            priority: 'high',
            parameter: 'minPriceDeviation',
            message: 'Low win rate. Consider increasing minimum price deviation from moving average.',
            currentValue: strategy.parameters?.minPriceDeviation || 'unknown',
            suggestedValue: '0.2-0.25 (20-25%)'
          });
        }
        
        if (analysis.avgPnlPercent < 3) {
          strategyRecommendations.push({
            priority: 'medium',
            parameter: 'profitTarget',
            message: 'Low average profit. Consider adjusting profit target.',
            currentValue: strategy.parameters?.profitTarget || 'unknown',
            suggestedValue: '0.08-0.12 (8-12%)'
          });
        }
      }
      
      recommendations[strategy.name] = strategyRecommendations;
    }
    
    return recommendations;
  }
  
  // Apply optimizations based on recommendations
  applyOptimizations(strategyModules) {
    try {
      logger.high('Applying strategy optimizations...');
      
      // Load analysis and recommendations
      const analysisPath = path.join(this.optimizationsDir, 'strategy_analysis.json');
      if (!fs.existsSync(analysisPath)) {
        throw new Error('Strategy analysis not found. Run analysis first.');
      }
      
      const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
      const recommendations = analysis.recommendations;
      
      // Apply optimizations to each strategy
      for (const [strategyName, strategyModule] of Object.entries(strategyModules)) {
        const strategyRecommendations = recommendations[strategyName];
        if (!strategyRecommendations || strategyRecommendations.length === 0) {
          logger.high(`No optimization recommendations for ${strategyName}`);
          continue;
        }
        
        logger.high(`Applying optimizations to ${strategyName}...`);
        
        // Apply high priority recommendations
        const highPriorityRecs = strategyRecommendations.filter(r => r.priority === 'high');
        for (const rec of highPriorityRecs) {
          this.applyRecommendation(strategyModule, rec);
        }
        
        // Apply medium priority recommendations
        const mediumPriorityRecs = strategyRecommendations.filter(r => r.priority === 'medium');
        for (const rec of mediumPriorityRecs) {
          this.applyRecommendation(strategyModule, rec);
        }
        
        logger.high(`Applied ${highPriorityRecs.length + mediumPriorityRecs.length} optimizations to ${strategyName}`);
      }
      
      // Save optimization summary
      const summaryPath = path.join(this.optimizationsDir, 'optimization_summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        appliedOptimizations: Object.entries(recommendations).map(([strategy, recs]) => ({
          strategy,
          appliedRecommendations: recs.filter(r => r.priority === 'high' || r.priority === 'medium').length,
          totalRecommendations: recs.length
        }))
      }, null, 2));
      
      logger.high(`Optimization summary saved to: ${summaryPath}`);
      
      return true;
    } catch (error) {
      logger.error(`Error applying optimizations: ${error.message}`);
      return false;
    }
  }
  
  // Apply a specific recommendation to a strategy
  applyRecommendation(strategyModule, recommendation) {
    try {
      const param = recommendation.parameter;
      
      // Skip general recommendations that don't have specific parameter changes
      if (param === 'general' || param === 'tokenFiltering' || param === 'tradingHours') {
        logger.deep(`Skipping general recommendation: ${recommendation.message}`);
        return false;
      }
      
      // Get current value
      if (!strategyModule.parameters || typeof strategyModule.parameters[param] === 'undefined') {
        logger.deep(`Parameter ${param} not found in strategy`);
        return false;
      }
      
      const currentValue = strategyModule.parameters[param];
      
      // Parse suggested value
      let newValue = currentValue;
      const suggested = recommendation.suggestedValue;
      
      if (typeof suggested === 'string') {
        // Parse range values like "0.05-0.08"
        const rangeMatch = suggested.match(/(\d+\.?\d*)-(\d+\.?\d*)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          
          // Use midpoint of range
          newValue = (min + max) / 2;
        } else if (suggested.includes('%')) {
          // Parse percentage values
          const percentMatch = suggested.match(/(\d+\.?\d*)%/);
          if (percentMatch) {
            newValue = parseFloat(percentMatch[1]) / 100;
          }
        } else if (suggested.includes('hours')) {
          // Parse hour values
          const hoursMatch = suggested.match(/(\d+\.?\d*)-(\d+\.?\d*) hours/);
          if (hoursMatch) {
            const minHours = parseFloat(hoursMatch[1]);
            const maxHours = parseFloat(hoursMatch[2]);
            
            // Convert to milliseconds
            newValue = Math.round((minHours + maxHours) / 2) * 60 * 60 * 1000;
          }
        }
      } else if (typeof suggested === 'number') {
        newValue = suggested;
      }
      
      // Apply the change if value is different
      if (newValue !== currentValue) {
        logger.deep(`Changing ${param} from ${currentValue} to ${newValue}`);
        strategyModule.parameters[param] = newValue;
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Error applying recommendation for ${recommendation.parameter}: ${error.message}`);
      return false;
    }
  }
}

module.exports = new StrategyAnalyzer();
