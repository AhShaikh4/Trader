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
    }

    // Rate limiting methods
    async queueRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject });
            
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
        const { requestFn, resolve, reject } = this.requestQueue.shift();
        this.requestTimestamps.push(now);
        
        try {
            const result = await requestFn();
            resolve(result);
        } catch (error) {
            reject(error);
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

    // Get all pairs from a specific DEX on Solana using direct endpoint
    async getPairsFromDex(dexId) {
        try {
            const cacheKey = `dex_${dexId}`;
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached pairs for DEX ${dexId}`);
                return cachedPairs;
            }
            
            logger.deep(`Fetching pairs from DEX ${dexId}`);
            
            // Use the direct tokens endpoint with chainId=solana
            // Then filter by dexId in the code
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/tokens/solana`)
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format from DEX ${dexId}`);
                return [];
            }
            
            // Filter to only include pairs from this DEX
            const pairs = response.data.pairs.filter(pair => 
                pair.dexId === dexId
            );
            
            logger.deep(`Found ${pairs.length} pairs on DEX ${dexId}`);
            
            // Cache the result
            this.cacheToken(cacheKey, pairs);
            
            return pairs;
        } catch (error) {
            logger.error(`Failed to fetch pairs from DEX ${dexId}: ${error.message}`);
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
            
            // Use the direct tokens endpoint
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/tokens/solana/${tokenAddress}`)
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format for token ${tokenAddress}`);
                return [];
            }
            
            const pools = response.data.pairs;
            
            logger.deep(`Found ${pools.length} pools for token ${tokenAddress}`);
            
            // Cache the result
            this.cacheToken(cacheKey, pools);
            
            return pools;
        } catch (error) {
            logger.error(`Failed to fetch pools for token ${tokenAddress}: ${error.message}`);
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
            
            // Get all pairs from Solana chain
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/tokens/solana`)
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error('Invalid response format for recent pairs');
                return [];
            }
            
            const allPairs = response.data.pairs;
            const now = Date.now();
            
            // Filter pairs by age and liquidity
            const recentPairs = allPairs.filter(pair => {
                if (!pair.pairCreatedAt) return false;
                
                const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                const hasMinLiquidity = pair.liquidity?.usd >= this.minLiquidity;
                
                return pairAge <= this.maxPairAge && hasMinLiquidity;
            });
            
            logger.deep(`Found ${recentPairs.length} recent pairs with minimum liquidity`);
            
            // Cache the result
            this.cacheToken(cacheKey, recentPairs);
            
            return recentPairs;
        } catch (error) {
            logger.error(`Failed to fetch recent pairs: ${error.message}`);
            return [];
        }
    }
    
    // Get trending tokens based on volume and price change without using keywords
    async getTrendingTokens() {
        try {
            logger.high('Fetching trending tokens based on volume and price change');
            
            // Get recent pairs from all DEXes
            const allPairs = await this.getRecentPairs();
            
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
            return [];
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
            
            // Get all pairs from Solana chain
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/tokens/solana`)
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error('Invalid response format for top volume pairs');
                return [];
            }
            
            const allPairs = response.data.pairs;
            
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
            return [];
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
            
            // Get all pairs from Solana chain
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/tokens/solana`)
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error('Invalid response format for price movement pairs');
                return [];
            }
            
            const allPairs = response.data.pairs;
            
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
            return [];
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
    
    // Comprehensive token discovery without using keywords
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive token discovery');
            
            // Reset processed pairs
            this.processedPairs.clear();
            
            const allDiscoveredPairs = [];
            
            // 1. Get trending tokens
            const trendingPairs = await this.getTrendingTokens();
            this.addUniquePairs(allDiscoveredPairs, trendingPairs);
            logger.deep(`Added ${trendingPairs.length} trending pairs`);
            
            // 2. Get top volume pairs
            const topVolumePairs = await this.getTopVolumePairs();
            this.addUniquePairs(allDiscoveredPairs, topVolumePairs);
            logger.deep(`Added ${this.countNewPairs(topVolumePairs)} new top volume pairs`);
            
            // 3. Get price movement pairs
            const priceMovementPairs = await this.getPriceMovementPairs();
            this.addUniquePairs(allDiscoveredPairs, priceMovementPairs);
            logger.deep(`Added ${this.countNewPairs(priceMovementPairs)} new price movement pairs`);
            
            // 4. Get recent pairs from top DEXes
            const popularDexes = await this.getPopularDexes();
            
            // Limit to top 10 DEXes to save API credits
            for (const dexId of popularDexes.slice(0, 10)) {
                const dexPairs = await this.getPairsFromDex(dexId);
                
                // Filter by recency and minimum liquidity
                const now = Date.now();
                const recentDexPairs = dexPairs.filter(pair => {
                    if (!pair.pairCreatedAt) return false;
                    
                    const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                    const hasMinLiquidity = pair.liquidity?.usd >= this.minLiquidity;
                    
                    return pairAge <= this.maxPairAge && hasMinLiquidity;
                });
                
                this.addUniquePairs(allDiscoveredPairs, recentDexPairs);
                logger.deep(`Added ${this.countNewPairs(recentDexPairs)} new pairs from DEX ${dexId}`);
            }
            
            logger.high(`Comprehensive token discovery complete. Found ${allDiscoveredPairs.length} unique pairs`);
            return allDiscoveredPairs;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            return [];
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
