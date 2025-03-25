require('dotenv').config();

module.exports = {
  SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY,
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
  TRADE_AMOUNT_CAD: 5,
  MIN_LIQUIDITY_USD: 10000,
  PROFIT_TARGET: 0.1, // 10%
  SLIPPAGE_BPS: 300,
  TRADE_INTERVAL_MS: 300000, // 5 minutes
  BITQUERY_OAUTH_TOKEN: process.env.BITQUERY_OAUTH_TOKEN,
  
  // Token discovery settings
  MIN_VOLUME_24H: 5000,
  MIN_UNIQUE_BUYERS: 20,
  MIN_BUY_SELL_RATIO: 1.2,
  MIN_PRICE_CONSISTENCY: 0.85,
  MIN_SCORE: 35,
  
  // Trade execution settings
  STOP_LOSS: 0.05,    // 5%
  
  // Monitoring settings
  MAX_CACHE_AGE_MS: 60000,   // 1 minute
  ANALYSIS_TIMEOUT_MS: 30000 // 30 seconds
};
