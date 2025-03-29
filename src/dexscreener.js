const axios = require('axios');
const logger = require('./logger');

class DexScreenerApi {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
        this.minLiquidity = 10000; // $10,000 minimum liquidity
        this.maxPairAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        
        // Cache implementation
        this.tokenCache = new Map();
        this.cacheExpiryTime = 30 * 60 * 1000; // 30 minutes
        
        // Rate limiting implementation
        this.requestQueue = [];
        this.processingQueue = false;
        this.requestsPerMinute = 250; // Keep below the 300 limit for safety
        this.requestTimestamps = [];
        
        // Track processed pairs to avoid duplicates
        this.processedPairs = new Set();
        
        // Track failed requests for retry
        this.failedRequests = new Map();
        this.maxRetries = 3;
    }

    // Rate limiting methods
    async queueRequest(requestFn, retryCount = 0) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject, retryCount });
            
            if (!this.processingQueue) {
                this.processRequestQueue();
            }
        });
    }

    async processRequestQueue() {
        if (this.requestQueue.length === 0) {
            this.processingQueue = false;
            return;
        }
        
        this.processingQueue = true;
        
        // Check if we're within rate limits
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(
            timestamp => now - timestamp < 60000
        );
        
        if (this.requestTimestamps.length >= this.requestsPerMinute) {
            // We've hit the rate limit, wait a bit
            const waitTime = 60000 - (now - this.requestTimestamps[0]);
            logger.deep(`Rate limit reached, waiting ${waitTime}ms`);
            setTimeout(() => this.processRequestQueue(), waitTime);
            return;
        }
        
        // Process next request
        const { requestFn, resolve, reject, retryCount } = this.requestQueue.shift();
        this.requestTimestamps.push(now);
        
        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            // Check if we should retry
            if (retryCount < this.maxRetries) {
                logger.deep(`Request failed, retrying (${retryCount + 1}/${this.maxRetries}): ${error.message}`);
                // Add back to queue with increased retry count
                this.requestQueue.push({ 
                    requestFn, 
                    resolve, 
                    reject, 
                    retryCount: retryCount + 1 
                });
            } else {
                reject(error);
            }
        }
        
        // Process next item with a small delay
        setTimeout(() => this.processRequestQueue(), 50);
    }

    // Cache methods
    cacheToken(key, data) {
        this.tokenCache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.tokenCache.get(key);
        if (!cached) return null;
        
        // Check if cache is expired
        if (Date.now() - cached.timestamp > this.cacheExpiryTime) {
            this.tokenCache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    // Get all pairs from a specific DEX on Solana using search endpoint
    async getPairsFromDex(dexId) {
        try {
            const cacheKey = `dex_${dexId}`;
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached pairs for DEX ${dexId}`);
                return cachedPairs;
            }
            
            logger.deep(`Fetching pairs from DEX ${dexId}`);
            
            // Use the search endpoint with dexId as part of the query
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: `solana ${dexId}`
                    }
                })
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format from DEX ${dexId}`);
                return this.getFallbackPairsForDex(dexId);
            }
            
            // Filter to only include pairs from Solana chain and this DEX
            const pairs = response.data.pairs.filter(pair => 
                pair.chainId === 'solana' && pair.dexId === dexId
            );
            
            logger.deep(`Found ${pairs.length} pairs on DEX ${dexId}`);
            
            // Cache the result
            this.cacheToken(cacheKey, pairs);
            
            return pairs;
        } catch (error) {
            logger.error(`Failed to fetch pairs from DEX ${dexId}: ${error.message}`);
            return this.getFallbackPairsForDex(dexId);
        }
    }
    
    // Fallback method to get pairs for a specific DEX
    async getFallbackPairsForDex(dexId) {
        try {
            logger.deep(`Trying fallback search for Solana pairs on ${dexId}`);
            
            // Try multiple fallback approaches
            const fallbackQueries = ['solana', 'sol'];
            
            for (const query of fallbackQueries) {
                try {
                    const fallbackResponse = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/search`, {
                            params: {
                                q: query
                            }
                        })
                    );
                    
                    if (!fallbackResponse.data || !fallbackResponse.data.pairs) {
                        continue;
                    }
                    
                    // Filter to only include pairs from Solana chain and this DEX
                    const fallbackPairs = fallbackResponse.data.pairs.filter(pair => 
                        pair.chainId === 'solana' && pair.dexId === dexId
                    );
                    
                    if (fallbackPairs.length > 0) {
                        logger.deep(`Found ${fallbackPairs.length} pairs on DEX ${dexId} using fallback query "${query}"`);
                        return fallbackPairs;
                    }
                } catch (fallbackError) {
                    logger.error(`Fallback search with query "${query}" failed: ${fallbackError.message}`);
                }
            }
            
            // If all fallbacks fail, try direct DEX endpoint if available
            try {
                const dexResponse = await this.queueRequest(() => 
                    axios.get(`${this.baseUrl}/dexes/${dexId}/pairs`)
                );
                
                if (!dexResponse.data || !dexResponse.data.pairs) {
                    return [];
                }
                
                // Filter to only include pairs from Solana chain
                const dexPairs = dexResponse.data.pairs.filter(pair => 
                    pair.chainId === 'solana'
                );
                
                logger.deep(`Found ${dexPairs.length} pairs on DEX ${dexId} using direct DEX endpoint`);
                return dexPairs;
            } catch (dexError) {
                logger.error(`Direct DEX endpoint for ${dexId} failed: ${dexError.message}`);
            }
            
            // If all approaches fail, return empty array
            logger.error(`All fallback approaches failed for DEX ${dexId}`);
            return [];
        } catch (error) {
            logger.error(`Fallback mechanism failed: ${error.message}`);
            return [];
        }
    }
    
    // Get all pools for a specific token
    async getTokenPools(tokenAddress) {
        try {
            if (!tokenAddress) {
                logger.error('Token address is required');
                return [];
            }
            
            const cacheKey = `pools_${tokenAddress}`;
            const cachedPools = this.getFromCache(cacheKey);
            
            if (cachedPools) {
                logger.deep(`Using cached pools for token ${tokenAddress}`);
                return cachedPools;
            }
            
            logger.deep(`Fetching pools for token ${tokenAddress}`);
            
            // Use the search endpoint with token address
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: tokenAddress
                    }
                })
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format for token ${tokenAddress}`);
                return this.getFallbackPoolsForToken(tokenAddress);
            }
            
            // Filter to only include pairs from Solana chain with this token
            const pools = response.data.pairs.filter(pair => 
                pair.chainId === 'solana' && 
                (pair.baseToken?.address === tokenAddress || pair.quoteToken?.address === tokenAddress)
            );
            
            logger.deep(`Found ${pools.length} pools for token ${tokenAddress}`);
            
            // Cache the result
            this.cacheToken(cacheKey, pools);
            
            return pools;
        } catch (error) {
            logger.error(`Failed to fetch pools for token ${tokenAddress}: ${error.message}`);
            return this.getFallbackPoolsForToken(tokenAddress);
        }
    }
    
    // Fallback method to get pools for a specific token
    async getFallbackPoolsForToken(tokenAddress) {
        try {
            logger.deep(`Trying fallback approach for token ${tokenAddress}`);
            
            // Try direct token endpoint
            try {
                const tokenResponse = await this.queueRequest(() => 
                    axios.get(`${this.baseUrl}/tokens/${tokenAddress}`)
                );
                
                if (tokenResponse.data && tokenResponse.data.pairs) {
                    // Filter to only include pairs from Solana chain
                    const tokenPairs = tokenResponse.data.pairs.filter(pair => 
                        pair.chainId === 'solana'
                    );
                    
                    logger.deep(`Found ${tokenPairs.length} pools for token ${tokenAddress} using direct token endpoint`);
                    return tokenPairs;
                }
            } catch (tokenError) {
                logger.error(`Direct token endpoint failed: ${tokenError.message}`);
            }
            
            // If direct endpoint fails, try getting all Solana pairs and filtering
            const allPairs = await this.getSolanaPairs();
            
            const filteredPairs = allPairs.filter(pair => 
                pair.baseToken?.address === tokenAddress || pair.quoteToken?.address === tokenAddress
            );
            
            logger.deep(`Found ${filteredPairs.length} pools for token ${tokenAddress} using filtered Solana pairs`);
            return filteredPairs;
        } catch (error) {
            logger.error(`All fallback approaches failed for token ${tokenAddress}: ${error.message}`);
            return [];
        }
    }
    
    // Get Solana pairs using search
    async getSolanaPairs() {
        try {
            logger.high('Fetching Solana pairs');
            
            const cacheKey = 'solana_pairs';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached Solana pairs`);
                return cachedPairs;
            }
            
            // Use search endpoint with "solana" query
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: 'solana'
                    }
                })
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format for Solana pairs`);
                return this.getFallbackSolanaPairs();
            }
            
            // Filter to only include pairs from Solana chain
            const solanaPairs = response.data.pairs.filter(pair => 
                pair.chainId === 'solana'
            );
            
            logger.deep(`Found ${solanaPairs.length} Solana pairs`);
            
            // Cache the result
            this.cacheToken(cacheKey, solanaPairs);
            
            return solanaPairs;
        } catch (error) {
            logger.error(`Failed to fetch Solana pairs: ${error.message}`);
            return this.getFallbackSolanaPairs();
        }
    }
    
    // Fallback method to get Solana pairs
    async getFallbackSolanaPairs() {
        try {
            logger.deep('Trying fallback approaches for Solana pairs');
            
            // Try multiple fallback queries
            const fallbackQueries = ['sol', 'solana chain'];
            
            for (const query of fallbackQueries) {
                try {
                    const fallbackResponse = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/search`, {
                            params: {
                                q: query
                            }
                        })
                    );
                    
                    if (!fallbackResponse.data || !fallbackResponse.data.pairs) {
                        continue;
                    }
                    
                    // Filter to only include pairs from Solana chain
                    const fallbackPairs = fallbackResponse.data.pairs.filter(pair => 
                        pair.chainId === 'solana'
                    );
                    
                    if (fallbackPairs.length > 0) {
                        logger.deep(`Found ${fallbackPairs.length} Solana pairs using fallback query "${query}"`);
                        return fallbackPairs;
                    }
                } catch (fallbackError) {
                    logger.error(`Fallback search with query "${query}" failed: ${fallbackError.message}`);
                }
            }
            
            // If all fallbacks fail, try getting pairs from popular DEXes
            const popularDexes = await this.getPopularDexes();
            let allPairs = [];
            
            for (const dexId of popularDexes.slice(0, 5)) {
                try {
                    const dexPairs = await this.getPairsFromDex(dexId);
                    allPairs = [...allPairs, ...dexPairs];
                } catch (dexError) {
                    logger.error(`Failed to get pairs from DEX ${dexId}: ${dexError.message}`);
                }
            }
            
            // Remove duplicates
            const uniquePairs = [];
            const seenPairAddresses = new Set();
            
            for (const pair of allPairs) {
                if (!seenPairAddresses.has(pair.pairAddress)) {
                    seenPairAddresses.add(pair.pairAddress);
                    uniquePairs.push(pair);
                }
            }
            
            logger.deep(`Found ${uniquePairs.length} unique Solana pairs from popular DEXes`);
            return uniquePairs;
        } catch (error) {
            logger.error(`All fallback approaches failed for Solana pairs: ${error.message}`);
            return [];
        }
    }
    
    // Get recent pairs from all DEXes on Solana
    async getRecentPairs() {
        try {
            logger.high('Fetching recent pairs from all DEXes on Solana');
            
            const cacheKey = 'recent_pairs_solana';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached recent pairs for Solana`);
                return cachedPairs;
            }
            
            // Get all Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            const now = Date.now();
            
            // Filter pairs by age and liquidity
            const recentPairs = allPairs.filter(pair => {
                if (!pair.pairCreatedAt) return false;
                
                const pairAge = now - pair.pairCreatedAt;
                const hasMinLiquidity = pair.liquidity?.usd >= this.minLiquidity;
                
                return pairAge <= this.maxPairAge && hasMinLiquidity;
            });
            
            logger.deep(`Found ${recentPairs.length} recent pairs with minimum liquidity`);
            
            // Cache the result
            this.cacheToken(cacheKey, recentPairs);
            
            return recentPairs;
        } catch (error) {
            logger.error(`Failed to fetch recent pairs: ${error.message}`);
            
            // Fallback: try getting recent pairs from each popular DEX
            try {
                logger.deep('Trying fallback approach for recent pairs');
                const popularDexes = await this.getPopularDexes();
                let allRecentPairs = [];
                const now = Date.now();
                
                for (const dexId of popularDexes.slice(0, 5)) {
                    try {
                        const dexPairs = await this.getPairsFromDex(dexId);
                        
                        // Filter by recency and liquidity
                        const recentDexPairs = dexPairs.filter(pair => {
                            if (!pair.pairCreatedAt) return false;
                            
                            const pairAge = now - pair.pairCreatedAt;
                            const hasMinLiquidity = pair.liquidity?.usd >= this.minLiquidity;
                            
                            return pairAge <= this.maxPairAge && hasMinLiquidity;
                        });
                        
                        allRecentPairs = [...allRecentPairs, ...recentDexPairs];
                    } catch (dexError) {
                        logger.error(`Failed to get recent pairs from DEX ${dexId}: ${dexError.message}`);
                    }
                }
                
                // Remove duplicates
                const uniquePairs = [];
                const seenPairAddresses = new Set();
                
                for (const pair of allRecentPairs) {
                    if (!seenPairAddresses.has(pair.pairAddress)) {
                        seenPairAddresses.add(pair.pairAddress);
                        uniquePairs.push(pair);
                    }
                }
                
                logger.deep(`Found ${uniquePairs.length} unique recent Solana pairs using fallback approach`);
                return uniquePairs;
            } catch (fallbackError) {
                logger.error(`Fallback approach for recent pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Get trending tokens based on volume and price change
    async getTrendingTokens() {
        try {
            logger.high('Fetching trending tokens based on volume and price change');
            
            // Get Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            // Filter out pairs with insufficient data
            const validPairs = allPairs.filter(pair => 
                pair.volume?.h24 && pair.liquidity?.usd && pair.priceChange?.h24
            );
            
            // Calculate a trending score for each pair
            const scoredPairs = validPairs.map(pair => {
                // Calculate volume to liquidity ratio (higher is better)
                const volumeToLiquidity = pair.volume.h24 / pair.liquidity.usd;
                
                // Calculate price change score (absolute value, higher is better)
                const priceChangeScore = Math.abs(pair.priceChange.h24);
                
                // Calculate combined score
                const score = (volumeToLiquidity * 50) + (priceChangeScore / 10);
                
                return {
                    ...pair,
                    trendingScore: score
                };
            });
            
            // Sort by trending score (highest first)
            scoredPairs.sort((a, b) => b.trendingScore - a.trendingScore);
            
            // Take top 50 trending pairs
            const trendingPairs = scoredPairs.slice(0, 50);
            
            logger.high(`Found ${trendingPairs.length} trending tokens`);
            return trendingPairs;
        } catch (error) {
            logger.error(`Failed to fetch trending tokens: ${error.message}`);
            
            // Fallback: try getting top volume pairs as a substitute
            try {
                const topVolumePairs = await this.getTopVolumePairs();
                logger.deep(`Using ${topVolumePairs.length} top volume pairs as fallback for trending tokens`);
                return topVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback for trending tokens failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Get top volume pairs from all DEXes on Solana
    async getTopVolumePairs() {
        try {
            logger.high('Fetching top volume pairs from all DEXes on Solana');
            
            const cacheKey = 'top_volume_pairs_solana';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached top volume pairs for Solana`);
                return cachedPairs;
            }
            
            // Get Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            // Filter pairs by minimum liquidity
            const liquidPairs = allPairs.filter(pair => 
                pair.liquidity?.usd >= this.minLiquidity
            );
            
            // Sort by 24h volume (highest first)
            liquidPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
            
            // Take top 50 volume pairs
            const topVolumePairs = liquidPairs.slice(0, 50);
            
            logger.deep(`Found ${topVolumePairs.length} top volume pairs`);
            
            // Cache the result
            this.cacheToken(cacheKey, topVolumePairs);
            
            return topVolumePairs;
        } catch (error) {
            logger.error(`Failed to fetch top volume pairs: ${error.message}`);
            
            // Fallback: try getting pairs from each popular DEX and sorting by volume
            try {
                logger.deep('Trying fallback approach for top volume pairs');
                const popularDexes = await this.getPopularDexes();
                let allPairs = [];
                
                for (const dexId of popularDexes.slice(0, 5)) {
                    try {
                        const dexPairs = await this.getPairsFromDex(dexId);
                        allPairs = [...allPairs, ...dexPairs];
                    } catch (dexError) {
                        logger.error(`Failed to get pairs from DEX ${dexId}: ${dexError.message}`);
                    }
                }
                
                // Filter by minimum liquidity
                const liquidPairs = allPairs.filter(pair => 
                    pair.liquidity?.usd >= this.minLiquidity
                );
                
                // Sort by 24h volume (highest first)
                liquidPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
                
                // Take top 50 volume pairs
                const topVolumePairs = liquidPairs.slice(0, 50);
                
                logger.deep(`Found ${topVolumePairs.length} top volume pairs using fallback approach`);
                return topVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback approach for top volume pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Get pairs with significant price movements
    async getPriceMovementPairs() {
        try {
            logger.high('Fetching pairs with significant price movements');
            
            const cacheKey = 'price_movement_pairs_solana';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached price movement pairs for Solana`);
                return cachedPairs;
            }
            
            // Get Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            // Filter pairs by minimum liquidity and significant price movement
            const significantPairs = allPairs.filter(pair => 
                pair.liquidity?.usd >= this.minLiquidity && 
                pair.priceChange?.h24 && 
                Math.abs(pair.priceChange.h24) >= 5 // 5% or more price change
            );
            
            // Sort by absolute price change (highest first)
            significantPairs.sort((a, b) => 
                Math.abs(b.priceChange?.h24 || 0) - Math.abs(a.priceChange?.h24 || 0)
            );
            
            // Take top 50 price movement pairs
            const topPriceMovementPairs = significantPairs.slice(0, 50);
            
            logger.deep(`Found ${topPriceMovementPairs.length} pairs with significant price movements`);
            
            // Cache the result
            this.cacheToken(cacheKey, topPriceMovementPairs);
            
            return topPriceMovementPairs;
        } catch (error) {
            logger.error(`Failed to fetch price movement pairs: ${error.message}`);
            
            // Fallback: try getting trending tokens as a substitute
            try {
                const trendingPairs = await this.getTrendingTokens();
                logger.deep(`Using ${trendingPairs.length} trending pairs as fallback for price movement pairs`);
                return trendingPairs;
            } catch (fallbackError) {
                logger.error(`Fallback for price movement pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }

    // Get popular DEXes on Solana
    async getPopularDexes() {
        // Return a list of popular DEXes on Solana
        return [
            'raydium',
            'orca',
            'jupiter',
            'meteora',
            'cykura',
            'saros',
            'step',
            'cropper',
            'lifinity',
            'aldrin',
            'dooar',
            'crema',
            'saber',
            'penguin',
            'mercurial',
            'atrix',
            'marinade',
            'goosefx',
            'symmetry',
            'mango',
            'serum',
            'openbook',
            'phoenix',
            'invariant',
            'fluxbeam',
            'pumpswap'
        ];
    }
    
    // Get pairs with high buy/sell ratio (bullish sentiment)
    async getBullishPairs() {
        try {
            logger.high('Fetching pairs with bullish sentiment');
            
            // Get Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            // Filter pairs with sufficient data
            const validPairs = allPairs.filter(pair => 
                pair.liquidity?.usd >= this.minLiquidity && 
                pair.txns?.h24?.buys && 
                pair.txns?.h24?.sells
            );
            
            // Calculate buy/sell ratio
            const scoredPairs = validPairs.map(pair => {
                const buys = pair.txns.h24.buys;
                const sells = pair.txns.h24.sells;
                
                // Avoid division by zero
                const buyToSellRatio = sells > 0 ? buys / sells : buys;
                
                return {
                    ...pair,
                    buyToSellRatio
                };
            });
            
            // Sort by buy/sell ratio (highest first)
            scoredPairs.sort((a, b) => b.buyToSellRatio - a.buyToSellRatio);
            
            // Take top 30 bullish pairs
            const bullishPairs = scoredPairs.slice(0, 30);
            
            logger.deep(`Found ${bullishPairs.length} pairs with bullish sentiment`);
            return bullishPairs;
        } catch (error) {
            logger.error(`Failed to fetch bullish pairs: ${error.message}`);
            
            // Fallback: try getting recent pairs as a substitute
            try {
                const recentPairs = await this.getRecentPairs();
                logger.deep(`Using ${recentPairs.length} recent pairs as fallback for bullish pairs`);
                return recentPairs;
            } catch (fallbackError) {
                logger.error(`Fallback for bullish pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Get pairs with high volume growth
    async getVolumeGrowthPairs() {
        try {
            logger.high('Fetching pairs with high volume growth');
            
            // Get Solana pairs
            const allPairs = await this.getSolanaPairs();
            
            // Filter pairs with sufficient data
            const validPairs = allPairs.filter(pair => 
                pair.liquidity?.usd >= this.minLiquidity && 
                pair.volume?.h24 && 
                pair.volume?.h6
            );
            
            // Calculate volume growth ratio
            const scoredPairs = validPairs.map(pair => {
                const h24Volume = pair.volume.h24;
                const h6Volume = pair.volume.h6;
                
                // Calculate hourly average volumes
                const avgHourlyH24 = h24Volume / 24;
                const avgHourlyH6 = h6Volume / 6;
                
                // Calculate growth ratio (recent hours vs overall average)
                const volumeGrowthRatio = avgHourlyH6 / avgHourlyH24;
                
                return {
                    ...pair,
                    volumeGrowthRatio
                };
            });
            
            // Sort by volume growth ratio (highest first)
            scoredPairs.sort((a, b) => b.volumeGrowthRatio - a.volumeGrowthRatio);
            
            // Take top 30 volume growth pairs
            const volumeGrowthPairs = scoredPairs.slice(0, 30);
            
            logger.deep(`Found ${volumeGrowthPairs.length} pairs with high volume growth`);
            return volumeGrowthPairs;
        } catch (error) {
            logger.error(`Failed to fetch volume growth pairs: ${error.message}`);
            
            // Fallback: try getting top volume pairs as a substitute
            try {
                const topVolumePairs = await this.getTopVolumePairs();
                logger.deep(`Using ${topVolumePairs.length} top volume pairs as fallback for volume growth pairs`);
                return topVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback for volume growth pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Comprehensive token discovery using data-driven metrics
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive Solana token discovery');
            
            // Reset processed pairs
            this.processedPairs.clear();
            
            const allDiscoveredPairs = [];
            let discoverySuccess = true;
            
            // 1. Get trending tokens
            try {
                const trendingPairs = await this.getTrendingTokens();
                this.addUniquePairs(allDiscoveredPairs, trendingPairs);
                logger.deep(`Added ${trendingPairs.length} trending pairs`);
            } catch (error) {
                logger.error(`Failed to get trending tokens: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 2. Get top volume pairs
            try {
                const topVolumePairs = await this.getTopVolumePairs();
                this.addUniquePairs(allDiscoveredPairs, topVolumePairs);
                logger.deep(`Added ${this.countNewPairs(topVolumePairs)} new top volume pairs`);
            } catch (error) {
                logger.error(`Failed to get top volume pairs: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 3. Get price movement pairs
            try {
                const priceMovementPairs = await this.getPriceMovementPairs();
                this.addUniquePairs(allDiscoveredPairs, priceMovementPairs);
                logger.deep(`Added ${this.countNewPairs(priceMovementPairs)} new price movement pairs`);
            } catch (error) {
                logger.error(`Failed to get price movement pairs: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 4. Get bullish sentiment pairs
            try {
                const bullishPairs = await this.getBullishPairs();
                this.addUniquePairs(allDiscoveredPairs, bullishPairs);
                logger.deep(`Added ${this.countNewPairs(bullishPairs)} new bullish sentiment pairs`);
            } catch (error) {
                logger.error(`Failed to get bullish sentiment pairs: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 5. Get volume growth pairs
            try {
                const volumeGrowthPairs = await this.getVolumeGrowthPairs();
                this.addUniquePairs(allDiscoveredPairs, volumeGrowthPairs);
                logger.deep(`Added ${this.countNewPairs(volumeGrowthPairs)} new volume growth pairs`);
            } catch (error) {
                logger.error(`Failed to get volume growth pairs: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 6. Get recent pairs from top DEXes
            try {
                const popularDexes = await this.getPopularDexes();
                
                // Limit to top 10 DEXes to save API credits
                for (const dexId of popularDexes.slice(0, 10)) {
                    try {
                        const dexPairs = await this.getPairsFromDex(dexId);
                        
                        // Filter by recency and minimum liquidity
                        const now = Date.now();
                        const recentDexPairs = dexPairs.filter(pair => {
                            if (!pair.pairCreatedAt) return false;
                            
                            const pairAge = now - pair.pairCreatedAt;
                            const hasMinLiquidity = pair.liquidity?.usd >= this.minLiquidity;
                            
                            return pairAge <= this.maxPairAge && hasMinLiquidity;
                        });
                        
                        this.addUniquePairs(allDiscoveredPairs, recentDexPairs);
                        logger.deep(`Added ${this.countNewPairs(recentDexPairs)} new pairs from DEX ${dexId}`);
                    } catch (error) {
                        logger.error(`Failed to get pairs from DEX ${dexId}: ${error.message}`);
                    }
                }
            } catch (error) {
                logger.error(`Failed to process DEX pairs: ${error.message}`);
                discoverySuccess = false;
            }
            
            // If we didn't find any pairs, try a fallback approach
            if (allDiscoveredPairs.length === 0) {
                logger.error('No pairs discovered, trying fallback approach');
                try {
                    const solanaPairs = await this.getSolanaPairs();
                    this.addUniquePairs(allDiscoveredPairs, solanaPairs);
                    logger.deep(`Added ${solanaPairs.length} pairs using fallback approach`);
                } catch (fallbackError) {
                    logger.error(`Fallback approach failed: ${fallbackError.message}`);
                }
            }
            
            // 7. Score and rank the discovered pairs
            const scoredPairs = allDiscoveredPairs.map(pair => {
                // Calculate volume to liquidity ratio (higher is better)
                const volumeToLiquidity = (pair.volume?.h24 || 0) / (pair.liquidity?.usd || 1);
                
                // Calculate price change score (absolute value, higher is better)
                const priceChangeScore = Math.abs(pair.priceChange?.h24 || 0);
                
                // Calculate age score (newer is better)
                const now = Date.now();
                const ageInDays = (now - (pair.pairCreatedAt || now)) / (24 * 60 * 60 * 1000);
                const ageScore = Math.max(0, 30 - ageInDays) / 30 * 100; // 0-100 score, 0 days = 100, 30+ days = 0
                
                // Calculate buy/sell ratio (higher is better)
                const buys = pair.txns?.h24?.buys || 0;
                const sells = pair.txns?.h24?.sells || 0;
                const buyToSellRatio = sells > 0 ? buys / sells : buys;
                const buyToSellScore = Math.min(100, buyToSellRatio * 25); // Cap at 100
                
                // Calculate volume growth score
                let volumeGrowthScore = 0;
                if (pair.volume?.h24 && pair.volume?.h6) {
                    const avgHourlyH24 = pair.volume.h24 / 24;
                    const avgHourlyH6 = pair.volume.h6 / 6;
                    const volumeGrowthRatio = avgHourlyH6 / avgHourlyH24;
                    volumeGrowthScore = Math.min(100, volumeGrowthRatio * 25); // Cap at 100
                }
                
                // Calculate combined score (0-100 scale)
                const score = (
                    (volumeToLiquidity * 30) +    // 0-30 points for volume/liquidity
                    (priceChangeScore / 2) +       // 0-25 points for 50% price change
                    (ageScore * 0.15) +            // 0-15 points for recency
                    (buyToSellScore * 0.15) +      // 0-15 points for buy/sell ratio
                    (volumeGrowthScore * 0.15)     // 0-15 points for volume growth
                );
                
                return {
                    ...pair,
                    profitPotentialScore: Math.min(100, score) // Cap at 100
                };
            });
            
            // Sort by profit potential score (highest first)
            scoredPairs.sort((a, b) => b.profitPotentialScore - a.profitPotentialScore);
            
            logger.high(`Comprehensive Solana token discovery complete. Found ${scoredPairs.length} unique pairs`);
            
            // Log the top 5 pairs
            if (scoredPairs.length > 0) {
                logger.high('Top 5 Solana token candidates:');
                scoredPairs.slice(0, 5).forEach((pair, index) => {
                    const symbol = pair.baseToken?.symbol || 'Unknown';
                    const name = pair.baseToken?.name || 'Unknown';
                    const price = pair.priceUsd || 'Unknown';
                    const score = pair.profitPotentialScore.toFixed(1);
                    const priceChange = pair.priceChange?.h24 ? `${pair.priceChange.h24.toFixed(2)}%` : 'Unknown';
                    const liquidity = pair.liquidity?.usd ? `$${pair.liquidity.usd.toLocaleString()}` : 'Unknown';
                    const volume = pair.volume?.h24 ? `$${pair.volume.h24.toLocaleString()}` : 'Unknown';
                    
                    logger.high(`${index + 1}. ${symbol} (${name}): $${price} | Score: ${score} | 24h: ${priceChange} | Liq: ${liquidity} | Vol: ${volume}`);
                });
            }
            
            // If some discovery methods failed but we still found pairs, that's a partial success
            if (!discoverySuccess && scoredPairs.length > 0) {
                logger.high(`Note: Some discovery methods failed, but we still found ${scoredPairs.length} pairs`);
            }
            
            return scoredPairs;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            
            // Last resort fallback
            try {
                logger.deep('Attempting last resort fallback for token discovery');
                const solanaPairs = await this.getSolanaPairs();
                
                // Sort by volume (highest first)
                solanaPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
                
                logger.deep(`Last resort fallback found ${solanaPairs.length} pairs`);
                return solanaPairs;
            } catch (fallbackError) {
                logger.error(`Last resort fallback failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Helper method to add unique pairs to the result array
    addUniquePairs(resultArray, newPairs) {
        for (const pair of newPairs) {
            if (!pair.baseToken?.address) continue;
            
            const pairKey = pair.baseToken.address;
            
            if (!this.processedPairs.has(pairKey)) {
                this.processedPairs.add(pairKey);
                resultArray.push(pair);
            }
        }
    }
    
    // Helper method to count new pairs that haven't been processed yet
    countNewPairs(pairs) {
        let count = 0;
        for (const pair of pairs) {
            if (!pair.baseToken?.address) continue;
            
            const pairKey = pair.baseToken.address;
            
            if (!this.processedPairs.has(pairKey)) {
                count++;
            }
        }
        return count;
    }
}

const dexScreenerApi = new DexScreenerApi();
module.exports = dexScreenerApi;
