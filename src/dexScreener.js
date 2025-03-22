const axios = require('axios');
const logger = require('./logger');

class DexScreener {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
        this.minLiquidity = 10000; // $10,000 minimum liquidity
        this.minVolume24h = 5000;  // $5,000 minimum 24h volume
        this.maxPairAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        this.idealVolumeToLiquidityRatio = 3; // Ideal daily volume should be 3x liquidity
        this.maxPriceChangeScore = 3; // Cap price change contribution to score
        this.searchQueries = [
            'solana memecoin',
            'solana new',
            'pump solana',
            'raydium new',
            'orca new token',
            'jupiter new'
        ];
        this.dexes = [
            'raydium', 
            'orca', 
            'jupiter',
            'meteora',
            'cykura',
            'saros',
            'step',
            'cropper',
            'lifinity'
        ];
        this.lastSearchIndex = 0;
        this.lastSearchTime = 0;
        this.searchInterval = 60000; // 1 minute between searches
        this.maxPages = 3; // Fetch up to 3 pages per DEX
    }

    async searchMemecoins() {
        try {
            logger.deep('Initiating memecoin search on DEX Screener');
            
            // Rotate through search queries
            const currentTime = Date.now();
            if (currentTime - this.lastSearchTime < this.searchInterval) {
                this.lastSearchIndex = (this.lastSearchIndex + 1) % this.searchQueries.length;
            }
            this.lastSearchTime = currentTime;

            // Select 3 random DEXes to search
            const selectedDexes = this.dexes
                .sort(() => Math.random() - 0.5)
                .slice(0, 3);

            // Make multiple searches in parallel
            const searchPromises = [
                // Search by current query
                this.searchByQuery(this.searchQueries[this.lastSearchIndex]),
                // Search on multiple DEXes
                ...selectedDexes.map(dex => this.searchByDex(dex))
            ];

            const results = await Promise.all(searchPromises);
            const allPairs = results.flat().filter(Boolean);

            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );

            // Apply filters with slightly relaxed criteria for new tokens
            const filteredPairs = uniquePairs.filter(pair => {
                if (!pair.chainId || !pair.liquidity?.usd || !pair.pairCreatedAt) {
                    return false;
                }

                const pairAge = Date.now() - new Date(pair.pairCreatedAt).getTime();
                return pair.chainId === 'solana' &&
                       ((pair.liquidity.usd >= this.minLiquidity) || 
                        (pairAge <= 24 * 60 * 60 * 1000 && pair.liquidity.usd >= this.minLiquidity / 2)) && // Lower liquidity requirement for new tokens
                       pairAge <= this.maxPairAge;
            });

            logger.deep(`Found ${filteredPairs.length} unique Solana pairs matching criteria from ${selectedDexes.join(', ')}`);
            return filteredPairs;
        } catch (error) {
            logger.error(`DEX Screener search failed: ${error.message}`);
            return [];
        }
    }

    async searchByQuery(query, page = 1) {
        try {
            const response = await axios.get(`${this.baseUrl}/search`, {
                params: {
                    q: query,
                    page
                }
            });

            return response.data?.pairs || [];
        } catch (error) {
            logger.error(`Query search failed for "${query}": ${error.message}`);
            return [];
        }
    }

    async searchByDex(dex) {
        try {
            const allPairs = [];
            
            // Fetch multiple pages in parallel
            const pagePromises = Array.from({ length: this.maxPages }, (_, i) => 
                axios.get(`${this.baseUrl}/pairs/solana/${dex}`, {
                    params: { page: i + 1 }
                }).catch(error => {
                    logger.error(`Failed to fetch page ${i + 1} for ${dex}: ${error.message}`);
                    return { data: { pairs: [] } };
                })
            );

            const responses = await Promise.all(pagePromises);
            responses.forEach(response => {
                if (response.data?.pairs) {
                    allPairs.push(...response.data.pairs);
                }
            });

            logger.deep(`Found ${allPairs.length} pairs on ${dex}`);
            return allPairs;
        } catch (error) {
            logger.error(`DEX search failed for "${dex}": ${error.message}`);
            return [];
        }
    }

    async getPairDetails(pairAddress) {
        try {
            logger.deep(`Fetching details for pair ${pairAddress}`);
            const response = await axios.get(`${this.baseUrl}/pairs/solana/${pairAddress}`);
            
            if (!response.data || !response.data.pair) {
                throw new Error('Invalid pair details response format');
            }

            logger.deep(`Successfully retrieved details for pair ${pairAddress}`);
            return response.data.pair;
        } catch (error) {
            logger.error(`Failed to get pair details for ${pairAddress}: ${error.message}`);
            return null;
        }
    }

    analyzeToken(pair) {
        try {
            logger.deep(`Analyzing token ${pair.baseToken?.symbol || 'Unknown'}`);
            const analysis = {
                address: pair.baseToken?.address,
                symbol: pair.baseToken?.symbol,
                liquidity: pair.liquidity?.usd || 0,
                volume24h: pair.volume?.h24 || 0,
                priceChange24h: pair.priceChange?.h24 || 0,
                createdAt: pair.pairCreatedAt,
                price: pair.priceUsd,
                score: 0,
                reasons: [],
                metrics: {}
            };

            // Calculate sophisticated metrics
            analysis.metrics.volumeToLiquidity = analysis.volume24h / analysis.liquidity;
            analysis.metrics.ageInHours = (new Date().getTime() - new Date(analysis.createdAt).getTime()) / (60 * 60 * 1000);
            analysis.metrics.priceChangeAdjusted = Math.min(Math.abs(analysis.priceChange24h) / 100, 5); // Cap at 500%

            // Liquidity scoring (0-3 points)
            if (analysis.liquidity >= this.minLiquidity) {
                const liquidityScore = Math.min(3, Math.floor(analysis.liquidity / 10000));
                analysis.score += liquidityScore;
                analysis.reasons.push(`Liquidity score: ${liquidityScore}`);
            }

            // Volume/Liquidity ratio scoring (0-3 points)
            if (analysis.metrics.volumeToLiquidity >= 0.5) {
                const vlRatio = analysis.metrics.volumeToLiquidity;
                const vlScore = Math.min(3, Math.floor(vlRatio / this.idealVolumeToLiquidityRatio));
                analysis.score += vlScore;
                analysis.reasons.push(`Volume/Liquidity ratio score: ${vlScore}`);
            }

            // Price change scoring (0-3 points, with diminishing returns)
            if (analysis.priceChange24h > 0) {
                const priceScore = Math.min(this.maxPriceChangeScore, 
                    Math.floor(Math.log10(1 + analysis.metrics.priceChangeAdjusted)));
                analysis.score += priceScore;
                analysis.reasons.push(`Price momentum score: ${priceScore}`);
            }

            // Age scoring (0-2 points, favoring newer tokens but not too new)
            if (analysis.metrics.ageInHours <= 168) { // 7 days
                const ageScore = analysis.metrics.ageInHours >= 24 ? 2 : 1; // Prefer tokens >24h old
                analysis.score += ageScore;
                analysis.reasons.push(`Age score: ${ageScore}`);
            }

            logger.token(JSON.stringify({
                ...analysis,
                detailedMetrics: {
                    volumeToLiquidity: analysis.metrics.volumeToLiquidity.toFixed(2),
                    ageInHours: Math.floor(analysis.metrics.ageInHours),
                    priceChangeNormalized: analysis.metrics.priceChangeAdjusted.toFixed(2)
                }
            }, null, 2));

            return analysis;
        } catch (error) {
            logger.error(`Token analysis failed: ${error.message}`);
            return null;
        }
    }

    async findTopMemecoins() {
        try {
            logger.high('Starting top memecoin search');
            const pairs = await this.searchMemecoins();
            const analysisResults = [];

            for (const pair of pairs) {
                const details = await this.getPairDetails(pair.pairAddress);
                if (details) {
                    const analysis = this.analyzeToken(details);
                    if (analysis) {
                        analysisResults.push(analysis);
                    }
                }
            }

            // Sort by score descending
            const topTokens = analysisResults
                .sort((a, b) => b.score - a.score)
                .slice(0, 5);

            logger.high(`Found ${topTokens.length} promising memecoin opportunities`);
            return topTokens;
        } catch (error) {
            logger.error(`Top memecoin search failed: ${error.message}`);
            return [];
        }
    }
}

module.exports = new DexScreener();