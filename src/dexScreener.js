const axios = require('axios');
const logger = require('./logger');

class DexScreener {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
    }

    async searchMemecoins() {
        try {
            const response = await axios.get(`${this.baseUrl}/search`, {
                params: {
                    q: 'solana memecoin'
                }
            });

            const solanaPairs = response.data.pairs.filter(pair => 
                pair.chainId === 'solana' &&
                pair.liquidity?.usd >= 10000
            );

            logger.deep(`Found ${solanaPairs.length} Solana pairs matching criteria`);
            return solanaPairs;
        } catch (error) {
            logger.error(`DEX Screener search failed: ${error.message}`);
            return [];
        }
    }

    async getPairDetails(pairAddress) {
        try {
            const response = await axios.get(`${this.baseUrl}/pairs/solana/${pairAddress}`);
            logger.deep(`Retrieved details for pair ${pairAddress}`);
            return response.data.pair || null;
        } catch (error) {
            logger.error(`Failed to get pair details for ${pairAddress}: ${error.message}`);
            return null;
        }
    }

    analyzeToken(pair) {
        try {
            const analysis = {
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                liquidity: pair.liquidity.usd,
                volume24h: pair.volume.h24,
                priceChange24h: pair.priceChange.h24,
                createdAt: pair.pairCreatedAt,
                score: 0
            };

            // Score based on criteria
            if (analysis.liquidity >= 10000) analysis.score += 1;
            if (analysis.volume24h > 5000) analysis.score += 1;
            if (analysis.priceChange24h > 50) analysis.score += 1;

            logger.token(JSON.stringify(analysis, null, 2));
            return analysis;
        } catch (error) {
            logger.error(`Token analysis failed: ${error.message}`);
            return null;
        }
    }
}

module.exports = new DexScreener();