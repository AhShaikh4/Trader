// Refined Token Discovery System with Optimized Age-Based Criteria
// This script implements a token discovery system that focuses on very recent tokens
// with different buying criteria based on token age, with optimized thresholds

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration based on user's specific requirements, with slightly relaxed thresholds
const CONFIG = {
  maxAgeHours: 24,        // Only look at tokens created in the last 24 hours
  veryRecentThreshold: 1, // Threshold in hours for "very recent" tokens
  chainId: 'solana',
  criteria: {
    veryRecent: {         // For tokens < 1 hour old
      minPriceChangeM5: 1,    // Reduced from 2% to 1%
      minVolumeM5: 500,       // Reduced from $1,000 to $500
      minLiquidityUsd: 3000   // Reduced from $5,000 to $3,000
    },
    recent: {             // For tokens 1-24 hours old
      minPriceChangeH1: 5,    // Reduced from 10% to 5%
      minVolumeH1: 5000,      // Reduced from $10,000 to $5,000
      minLiquidityUsd: 3000   // Reduced from $5,000 to $3,000
    }
  },
  // Add fallback criteria if no tokens meet primary criteria
  fallbackCriteria: {
    enabled: true,
    veryRecent: {
      minPriceChangeM5: 0.5,  // Even more relaxed criteria
      minVolumeM5: 100,
      minLiquidityUsd: 1000
    },
    recent: {
      minPriceChangeH1: 2,
      minVolumeH1: 1000,
      minLiquidityUsd: 1000
    }
  }
};

// Helper function to calculate date from hours ago
const getDateHoursAgo = (hours) => {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
};

// Helper function to calculate age in hours
function getAgeInHours(timestamp) {
  const created = new Date(timestamp);
  const now = new Date();
  const diffMs = now - created;
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours;
}

// Function to fetch recent tokens from DexScreener
async function findRecentTokens() {
  try {
    console.log('Fetching recent tokens from DexScreener...');
    
    // Use multiple search queries to find recent tokens
    const searchQueries = ['SOL', 'solana', 'raydium', 'orca', 'jupiter', 'pump', 'new', 'launch'];
    let allPairs = [];
    
    for (const query of searchQueries) {
      console.log(`Searching with query: ${query}`);
      
      // Make API request to DexScreener
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${query}`);
      
      if (response.data && response.data.pairs) {
        console.log(`Found ${response.data.pairs.length} pairs with query "${query}"`);
        allPairs = [...allPairs, ...response.data.pairs];
      }
    }
    
    console.log(`Found ${allPairs.length} total pairs before filtering and removing duplicates`);
    
    // Remove duplicates based on pair address
    const uniquePairs = Array.from(
      new Map(allPairs.map(item => [item.pairAddress, item])).values()
    );
    
    console.log(`Found ${uniquePairs.length} unique pairs after removing duplicates`);
    
    // Calculate cutoff date for pair age
    const cutoffDate = getDateHoursAgo(CONFIG.maxAgeHours);
    
    // Filter pairs based on chain ID and age
    const recentTokens = uniquePairs.filter(pair => {
      // Check chain ID
      if (pair.chainId !== CONFIG.chainId) return false;
      
      // Check pair creation date
      const pairCreatedAt = new Date(pair.pairCreatedAt);
      if (pairCreatedAt < cutoffDate) return false;
      
      return true;
    });
    
    console.log(`Found ${recentTokens.length} tokens created in the last ${CONFIG.maxAgeHours} hours`);
    
    // Sort by creation date (newest first)
    recentTokens.sort((a, b) => {
      return new Date(b.pairCreatedAt) - new Date(a.pairCreatedAt);
    });
    
    return recentTokens;
  } catch (error) {
    console.error('Error fetching or filtering token pairs:', error.message);
    return [];
  }
}

// Function to apply age-based buying criteria
function applyAgeBuyingCriteria(tokens, useFallback = false) {
  const criteriaSet = useFallback ? CONFIG.fallbackCriteria : CONFIG.criteria;
  
  console.log(`\nApplying ${useFallback ? 'fallback' : 'primary'} age-based buying criteria...`);
  
  if (useFallback) {
    console.log('Using relaxed criteria thresholds:');
    console.log(`Very Recent (<1h): m5 change > ${criteriaSet.veryRecent.minPriceChangeM5}%, m5 volume > $${criteriaSet.veryRecent.minVolumeM5}, liquidity > $${criteriaSet.veryRecent.minLiquidityUsd}`);
    console.log(`Recent (1-24h): h1 change > ${criteriaSet.recent.minPriceChangeH1}%, h1 volume > $${criteriaSet.recent.minVolumeH1}, liquidity > $${criteriaSet.recent.minLiquidityUsd}`);
  }
  
  const buyDecisions = tokens.map(token => {
    // Calculate age in hours
    const ageHours = getAgeInHours(token.pairCreatedAt);
    
    // Determine which criteria to apply based on age
    const isVeryRecent = ageHours < CONFIG.veryRecentThreshold;
    const criteria = isVeryRecent ? criteriaSet.veryRecent : criteriaSet.recent;
    
    // Initialize decision object
    const decision = {
      token,
      ageHours,
      isVeryRecent,
      appliedCriteria: isVeryRecent ? 'Very Recent (<1h)' : 'Recent (1-24h)',
      criteriaLevel: useFallback ? 'Fallback' : 'Primary',
      checks: {},
      buyDecision: false
    };
    
    // Apply criteria based on token age
    if (isVeryRecent) {
      // For tokens less than 1 hour old
      decision.checks.priceChangeM5 = token.priceChange && token.priceChange.m5 > criteria.minPriceChangeM5;
      decision.checks.volumeM5 = token.volume && token.volume.m5 && parseFloat(token.volume.m5) > criteria.minVolumeM5;
      decision.checks.liquidity = token.liquidity && token.liquidity.usd && parseFloat(token.liquidity.usd) > criteria.minLiquidityUsd;
      
      // All criteria must be met
      decision.buyDecision = decision.checks.priceChangeM5 && decision.checks.volumeM5 && decision.checks.liquidity;
      
      // Add detailed metrics for debugging
      decision.metrics = {
        priceChangeM5: token.priceChange?.m5 || 'N/A',
        volumeM5: token.volume?.m5 || 'N/A',
        liquidity: token.liquidity?.usd || 'N/A'
      };
    } else {
      // For tokens 1-24 hours old
      decision.checks.priceChangeH1 = token.priceChange && token.priceChange.h1 > criteria.minPriceChangeH1;
      decision.checks.volumeH1 = token.volume && token.volume.h1 && parseFloat(token.volume.h1) > criteria.minVolumeH1;
      decision.checks.liquidity = token.liquidity && token.liquidity.usd && parseFloat(token.liquidity.usd) > criteria.minLiquidityUsd;
      
      // All criteria must be met
      decision.buyDecision = decision.checks.priceChangeH1 && decision.checks.volumeH1 && decision.checks.liquidity;
      
      // Add detailed metrics for debugging
      decision.metrics = {
        priceChangeH1: token.priceChange?.h1 || 'N/A',
        volumeH1: token.volume?.h1 || 'N/A',
        liquidity: token.liquidity?.usd || 'N/A'
      };
    }
    
    return decision;
  });
  
  // Filter to only include positive buy decisions
  const positiveBuyDecisions = buyDecisions.filter(decision => decision.buyDecision);
  
  console.log(`Found ${positiveBuyDecisions.length} tokens meeting the ${useFallback ? 'fallback' : 'primary'} buying criteria`);
  
  return {
    all: buyDecisions,
    buy: positiveBuyDecisions
  };
}

// Function to display tokens in a readable format
function displayBuyDecisions(buyDecisions) {
  if (buyDecisions.length === 0) {
    console.log('\nNo tokens meeting the buying criteria were found at this time.');
    return;
  }
  
  console.log('\nTokens Meeting Buying Criteria:');
  console.log('=============================');
  
  buyDecisions.forEach((decision, index) => {
    const token = decision.token;
    console.log(`#${index + 1}: ${token.baseToken.symbol}/${token.quoteToken.symbol} (${decision.criteriaLevel} Criteria)`);
    console.log(`Age: ${decision.ageHours.toFixed(2)} hours (${decision.appliedCriteria})`);
    console.log(`Price: $${token.priceUsd}`);
    
    if (decision.isVeryRecent) {
      console.log(`5m Change: ${token.priceChange?.m5 || 'N/A'}%, 5m Volume: $${token.volume?.m5 || 'N/A'}`);
    } else {
      console.log(`1h Change: ${token.priceChange?.h1 || 'N/A'}%, 1h Volume: $${token.volume?.h1 || 'N/A'}`);
    }
    
    console.log(`Liquidity: $${token.liquidity.usd}`);
    console.log(`Created: ${new Date(token.pairCreatedAt).toLocaleString()}`);
    console.log(`URL: ${token.url}`);
    console.log('-----------------------------');
  });
}

// Function to save buy decisions to a file
function saveBuyDecisionsToFile(buyDecisions) {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = path.join(__dirname, `buy_decisions_${timestamp}.json`);
  
  fs.writeFileSync(filename, JSON.stringify(buyDecisions, null, 2));
  console.log(`Saved buy decisions to ${filename}`);
  
  // Also save a human-readable version
  const readableFilename = path.join(__dirname, `buy_decisions_${timestamp}.txt`);
  
  let content = '';
  if (buyDecisions.length === 0) {
    content = 'No tokens meeting the buying criteria were found at this time.';
  } else {
    content = 'Tokens Meeting Buying Criteria:\n=============================\n\n';
    
    buyDecisions.forEach((decision, index) => {
      const token = decision.token;
      content += `#${index + 1}: ${token.baseToken.symbol}/${token.quoteToken.symbol} (${decision.criteriaLevel} Criteria)\n`;
      content += `Age: ${decision.ageHours.toFixed(2)} hours (${decision.appliedCriteria})\n`;
      content += `Price: $${token.priceUsd}\n`;
      
      if (decision.isVeryRecent) {
        content += `5m Change: ${token.priceChange?.m5 || 'N/A'}%, 5m Volume: $${token.volume?.m5 || 'N/A'}\n`;
      } else {
        content += `1h Change: ${token.priceChange?.h1 || 'N/A'}%, 1h Volume: $${token.volume?.h1 || 'N/A'}\n`;
      }
      
      content += `Liquidity: $${token.liquidity.usd}\n`;
      content += `Created: ${new Date(token.pairCreatedAt).toLocaleString()}\n`;
      content += `URL: ${token.url}\n`;
      content += '-----------------------------\n\n';
    });
  }
  
  fs.writeFileSync(readableFilename, content);
  console.log(`Saved readable buy decisions to ${readableFilename}`);
  
  return { jsonFile: filename, textFile: readableFilename };
}

// Function to create a buy execution plan
function createBuyExecutionPlan(buyDecisions) {
  if (buyDecisions.length === 0) {
    console.log('No tokens to create buy execution plan for.');
    return null;
  }
  
  console.log('\nBuy Execution Plan:');
  console.log('==================');
  
  // Sort by age (newest first)
  const sortedDecisions = [...buyDecisions].sort((a, b) => a.ageHours - b.ageHours);
  
  // Calculate investment amount - more for newer tokens and primary criteria matches
  const totalTokens = sortedDecisions.length;
  const baseAmount = 1000; // Base amount per token
  
  const executionPlan = {
    timestamp: new Date().toISOString(),
    totalTokens: totalTokens,
    totalInvestment: 0,
    tokens: sortedDecisions.map((decision, index) => {
      // Calculate buy amount - newer tokens get more investment
      const ageFactorMultiplier = Math.max(0.5, 1 - (decision.ageHours / CONFIG.maxAgeHours));
      // Primary criteria matches get full amount, fallback get 70%
      const criteriaMultiplier = decision.criteriaLevel === 'Primary' ? 1.0 : 0.7;
      const buyAmount = baseAmount * ageFactorMultiplier * criteriaMultiplier;
      
      console.log(`${index + 1}. Buy ${decision.token.baseToken.symbol} for $${buyAmount.toFixed(2)}`);
      console.log(`   Age: ${decision.ageHours.toFixed(2)} hours, Price: $${decision.token.priceUsd}`);
      console.log(`   Criteria: ${decision.criteriaLevel}, Category: ${decision.appliedCriteria}`);
      console.log(`   URL: ${decision.token.url}`);
      
      return {
        priority: index + 1,
        symbol: decision.token.baseToken.symbol,
        pairAddress: decision.token.pairAddress,
        age: decision.ageHours,
        ageCategory: decision.appliedCriteria,
        criteriaLevel: decision.criteriaLevel,
        amount: buyAmount.toFixed(2),
        price: decision.token.priceUsd,
        url: decision.token.url
      };
    })
  };
  
  // Calculate total investment
  executionPlan.totalInvestment = executionPlan.tokens.reduce(
    (sum, token) => sum + parseFloat(token.amount), 
    0
  ).toFixed(2);
  
  console.log(`\nTotal investment amount: $${executionPlan.totalInvestment}`);
  
  // Save execution plan to file
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = path.join(__dirname, `buy_execution_plan_${timestamp}.json`);
  fs.writeFileSync(filename, JSON.stringify(executionPlan, null, 2));
  console.log(`\nSaved buy execution plan to ${filename}`);
  
  return executionPlan;
}

// Function to analyze why tokens failed to meet criteria
function analyzeFailedCriteria(decisions) {
  if (decisions.length === 0) {
    console.log('No tokens to analyze.');
    return;
  }
  
  console.log('\nAnalyzing why tokens failed to meet criteria:');
  console.log('===========================================');
  
  // Count failure reasons
  const failureReasons = {
    veryRecent: {
      priceChangeM5: 0,
      volumeM5: 0,
      liquidity: 0,
      total: 0
    },
    recent: {
      priceChangeH1: 0,
      volumeH1: 0,
      liquidity: 0,
      total: 0
    }
  };
  
  // Analyze each token
  decisions.filter(d => !d.buyDecision).forEach(decision => {
    if (decision.isVeryRecent) {
      failureReasons.veryRecent.total++;
      if (!decision.checks.priceChangeM5) failureReasons.veryRecent.priceChangeM5++;
      if (!decision.checks.volumeM5) failureReasons.veryRecent.volumeM5++;
      if (!decision.checks.liquidity) failureReasons.veryRecent.liquidity++;
    } else {
      failureReasons.recent.total++;
      if (!decision.checks.priceChangeH1) failureReasons.recent.priceChangeH1++;
      if (!decision.checks.volumeH1) failureReasons.recent.volumeH1++;
      if (!decision.checks.liquidity) failureReasons.recent.liquidity++;
    }
  });
  
  // Display results
  console.log('Very Recent Tokens (<1h):');
  console.log(`- Total failed: ${failureReasons.veryRecent.total}`);
  if (failureReasons.veryRecent.total > 0) {
    console.log(`- Failed price change criteria: ${failureReasons.veryRecent.priceChangeM5} (${Math.round(failureReasons.veryRecent.priceChangeM5 / failureReasons.veryRecent.total * 100)}%)`);
    console.log(`- Failed volume criteria: ${failureReasons.veryRecent.volumeM5} (${Math.round(failureReasons.veryRecent.volumeM5 / failureReasons.veryRecent.total * 100)}%)`);
    console.log(`- Failed liquidity criteria: ${failureReasons.veryRecent.liquidity} (${Math.round(failureReasons.veryRecent.liquidity / failureReasons.veryRecent.total * 100)}%)`);
  }
  
  console.log('\nRecent Tokens (1-24h):');
  console.log(`- Total failed: ${failureReasons.recent.total}`);
  if (failureReasons.recent.total > 0) {
    console.log(`- Failed price change criteria: ${failureReasons.recent.priceChangeH1} (${Math.round(failureReasons.recent.priceChangeH1 / failureReasons.recent.total * 100)}%)`);
    console.log(`- Failed volume criteria: ${failureReasons.recent.volumeH1} (${Math.round(failureReasons.recent.volumeH1 / failureReasons.recent.total * 100)}%)`);
    console.log(`- Failed liquidity criteria: ${failureReasons.recent.liquidity} (${Math.round(failureReasons.recent.liquidity / failureReasons.recent.total * 100)}%)`);
  }
  
  return failureReasons;
}

// Main function to run the token discovery
async function main() {
  console.log('Starting optimized token discovery with age-based criteria...');
  console.log('Filtering criteria:');
  console.log(`- Chain ID: ${CONFIG.chainId}`);
  console.log(`- Max age: ${CONFIG.maxAgeHours} hours`);
  console.log(`- Very recent threshold: ${CONFIG.veryRecentThreshold} hour`);
  console.log('\nPrimary Very Recent Criteria (<1h):');
  console.log(`- Min 5m price change: ${CONFIG.criteria.veryRecent.minPriceChangeM5}%`);
  console.log(`- Min 5m volume: $${CONFIG.criteria.veryRecent.minVolumeM5}`);
  console.log(`- Min liquidity: $${CONFIG.criteria.veryRecent.minLiquidityUsd}`);
  console.log('\nPrimary Recent Criteria (1-24h):');
  console.log(`- Min 1h price change: ${CONFIG.criteria.recent.minPriceChangeH1}%`);
  console.log(`- Min 1h volume: $${CONFIG.criteria.recent.minVolumeH1}`);
  console.log(`- Min liquidity: $${CONFIG.criteria.recent.minLiquidityUsd}`);
  
  if (CONFIG.fallbackCriteria.enabled) {
    console.log('\nFallback criteria enabled (will be used if no tokens meet primary criteria)');
  }
  
  // Find recent tokens
  const recentTokens = await findRecentTokens();
  
  // Apply primary age-based buying criteria
  const primaryDecisions = applyAgeBuyingCriteria(recentTokens, false);
  
  // If no tokens meet primary criteria and fallback is enabled, try fallback criteria
  let finalDecisions = primaryDecisions;
  if (primaryDecisions.buy.length === 0 && CONFIG.fallbackCriteria.enabled) {
    console.log('\nNo tokens met primary criteria. Trying fallback criteria...');
    finalDecisions = applyAgeBuyingCriteria(recentTokens, true);
  }
  
  // Display and save buy decisions
  displayBuyDecisions(finalDecisions.buy);
  const files = saveBuyDecisionsToFile(finalDecisions.buy);
  
  // Analyze why tokens failed to meet criteria
  const failureAnalysis = analyzeFailedCriteria(finalDecisions.all);
  
  // Create execution plan
  const executionPlan = createBuyExecutionPlan(finalDecisions.buy);
  
  return {
    allTokens: recentTokens,
    primaryDecisions: primaryDecisions,
    finalDecisions: finalDecisions,
    failureAnalysis: failureAnalysis,
    files,
    executionPlan
  };
}

// Run the token discovery
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
  });
}

module.exports = {
  findRecentTokens,
  applyAgeBuyingCriteria,
  displayBuyDecisions,
  saveBuyDecisionsToFile,
  createBuyExecutionPlan,
  analyzeFailedCriteria,
  main
};
