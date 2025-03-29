// Update config.js to include API keys
require('dotenv').config();

module.exports = {
  SOLANA_PRIVATE_KEY: process.env.SOLANA_PRIVATE_KEY || 'dummy_key_for_paper_trading',
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY,
  MORALIS_API_KEY: process.env.MORALIS_API_KEY,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  LOG_LEVEL: process.env.LOG_LEVEL || 'high',
  TRADE_AMOUNT_CAD: 5,
  MIN_LIQUIDITY_USD: 10000,
  PROFIT_TARGET: 0.1, // 10%
  SLIPPAGE_BPS: 300,
  TRADE_INTERVAL_MS: 300000 // 5 minutes
};
