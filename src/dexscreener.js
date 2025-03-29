const axios = require('axios');
const logger = require('./logger');

class DexScreenerApi {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
        this.tokenPairsUrl = 'https://api.dexscreener.com/token-pairs/v1';
        this.minLiquidity = 10000; // $10,000 minimum liquidity
        this.maxPairAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        
        // Cache implementation
        this.tokenCache = new Map();
        this.cacheExpiryTime = 30 * 60 * 1000; // 30 minutes
        
        // Rate limiting implementation
        this.requestQueue = [];
        this.processingQueue = false;
        this.requestsPerMinute = 55; // More conservative rate limit (55 vs 250)
        this.requestTimestamps = [];
        
        // Token diversity tracking
        this.lastFetchedTokens = new Set();
        this.fetchCounter = 0;
        
        // Track processed pairs to avoid duplicates
        this.processedPairs = new Set();
        
        // Track failed requests for retry
        this.failedRequests = new Map();
        this.maxRetries = 3;
    }

    // Rate limiting methods with retry mechanism
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

    // Get all pairs from a specific DEX on Solana
    async getPairsFromDex(dexId) {
        try {
            const cacheKey = `dex_${dexId}`;
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached pairs for DEX ${dexId}`);
                return cachedPairs;
            }
            
            logger.deep(`Fetching pairs from DEX ${dexId}`);
            
            // Use the search endpoint with the DEX name as query
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: `${dexId} solana`
                    }
                })
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format from DEX ${dexId}`);
                return this.getFallbackPairsForDex(dexId);
            }
            
            // Filter to only include pairs from this DEX
            const pairs = response.data.pairs.filter(pair => 
                pair.dexId === dexId && pair.chainId === 'solana'
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
                                q: `${query} ${dexId}`
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
            
            // Use the token-pairs endpoint to get all pools for this token
            const response = await this.queueRequest(() => 
                axios.get(`${this.tokenPairsUrl}/solana/${tokenAddress}`)
            );
            
            if (!response.data || !Array.isArray(response.data)) {
                logger.error(`Invalid response format for token ${tokenAddress}`);
                return this.getFallbackPoolsForToken(tokenAddress);
            }
            
            const pools = response.data;
            
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
            
            // Try search endpoint with token address
            try {
                const searchResponse = await this.queueRequest(() => 
                    axios.get(`${this.baseUrl}/search`, {
                        params: {
                            q: tokenAddress
                        }
                    })
                );
                
                if (searchResponse.data && searchResponse.data.pairs) {
                    // Filter to only include pairs from Solana chain with this token
                    const searchPairs = searchResponse.data.pairs.filter(pair => 
                        pair.chainId === 'solana' && 
                        (pair.baseToken?.address === tokenAddress || pair.quoteToken?.address === tokenAddress)
                    );
                    
                    if (searchPairs.length > 0) {
                        logger.deep(`Found ${searchPairs.length} pools for token ${tokenAddress} using search endpoint`);
                        return searchPairs;
                    }
                }
            } catch (searchError) {
                logger.error(`Search endpoint failed: ${searchError.message}`);
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
    
    // Get Solana pairs using search with rotating queries
    async getSolanaPairs() {
        try {
            logger.high('Fetching Solana pairs');
            
            const cacheKey = 'solana_pairs';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep(`Using cached Solana pairs`);
                return cachedPairs;
            }
            
            // Increment fetch counter to track calls
            this.fetchCounter++;
            
            // Use a wider variety of search queries that rotate based on fetch counter
            const allQueries = [
                'solana',
                'sol',
                'solana chain',
                'sol chain',
                'solana dex'
            ];
            
            // Select a query based on the fetch counter
            const queryIndex = this.fetchCounter % allQueries.length;
            const query = allQueries[queryIndex];
            
            logger.deep(`Using query: "${query}"`);
            
            // Use search endpoint with the selected query
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: query
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
            const fallbackQueries = ['solana token', 'sol token', 'solana crypto'];
            
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
    
    // Get trending tokens with improved diversity and rotating queries
    async getTrendingTokens() {
        try {
            logger.high('Fetching trending tokens from DexScreener');
            
            // Increment fetch counter to track calls
            this.fetchCounter++;
            
            // Use a wider variety of search queries that rotate based on fetch counter
            // This helps ensure we get different tokens on each call
            const allQueries = [
                // Volume-based queries
                'volume solana',
                'high volume solana',
                'volume 24h solana',
                'liquidity solana',
                
                // Trending/popularity queries
                'trending solana',
                'popular solana',
                'hot solana',
                
                // Price action queries
                'pump solana',
                'price change solana',
                'movers solana',
                
                // Timeframe-based queries
                'new solana',
                'recent solana',
                'launch solana',
                
                // DEX-specific queries
                'raydium new',
                'jupiter trending',
                'orca volume',
                
                // Combination queries
                'new high volume solana',
                'trending pump solana',
                'hot tokens solana'
            ];
            
            // Select a subset of queries based on the fetch counter
            // This ensures we rotate through different query sets on each call
            const querySetSize = 5;
            const startIndex = (this.fetchCounter * querySetSize) % allQueries.length;
            const selectedQueries = [];
            
            for (let i = 0; i < querySetSize; i++) {
                const index = (startIndex + i) % allQueries.length;
                selectedQueries.push(allQueries[index]);
            }
            
            logger.deep(`Using query set: ${selectedQueries.join(', ')}`);
            
            const allPairs = [];
            
            // Fetch results for each selected query
            for (const query of selectedQueries) {
                try {
                    const response = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/search`, {
                            params: { q: query }
                        })
                    );
                    
                    if (response.data && response.data.pairs) {
                        // Filter to only include Solana pairs
                        const solanaPairs = response.data.pairs.filter(pair => 
                            pair.chainId === 'solana'
                        );
                        
                        allPairs.push(...solanaPairs);
                        logger.deep(`Found ${solanaPairs.length} pairs for query "${query}"`);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch trending pairs for query "${query}": ${error.message}`);
                    // Continue with other queries even if one fails
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            // Filter out pairs with insufficient data
            const validPairs = uniquePairs.filter(pair => 
                pair.baseToken?.address && 
                pair.volume?.h24 && 
                pair.liquidity?.usd && 
                pair.priceChange
            );
            
            // Calculate a trending score for each pair using multiple metrics
            const scoredPairs = validPairs.map(pair => {
                // Calculate volume to liquidity ratio (higher is better)
                const volumeToLiquidity = pair.volume.h24 / pair.liquidity.usd;
                
                // Calculate price change score (absolute value, higher is better)
                const priceChangeScore = Math.abs(pair.priceChange.h24 || 0);
                
                // Calculate age score (newer is better)
                const now = Date.now();
                const pairAge = pair.pairCreatedAt ? (now - pair.pairCreatedAt) : 0;
                const ageScore = pairAge > 0 ? Math.max(0, 1 - (pairAge / this.maxPairAge)) : 0;
                
                // Calculate buy/sell ratio (higher is better)
                const buys = pair.txns?.h24?.buys || 0;
                const sells = pair.txns?.h24?.sells || 0;
                const buyToSellRatio = sells > 0 ? buys / sells : buys;
                const buyToSellScore = Math.min(5, buyToSellRatio);
                
                // Calculate combined score
                const score = (volumeToLiquidity * 40) + 
                              (priceChangeScore / 10) + 
                              (ageScore * 20) + 
                              (buyToSellScore * 5);
                
                return {
                    ...pair,
                    trendingScore: score
                };
            });
            
            // Sort by trending score (highest first)
            scoredPairs.sort((a, b) => b.trendingScore - a.trendingScore);
            
            // Track which tokens we've already returned
            const previousTokens = new Set(this.lastFetchedTokens);
            
            // Filter out tokens we returned in the previous call to ensure diversity
            const diversePairs = scoredPairs.filter(pair => 
                !previousTokens.has(pair.baseToken.address)
            );
            
            // If we filtered out too many, add some back from the original list
            let resultPairs = diversePairs;
            if (diversePairs.length < 10 && scoredPairs.length > 0) {
                // Take some from the original list to ensure we have enough results
                const remainingNeeded = Math.min(10, scoredPairs.length) - diversePairs.length;
                const additionalPairs = scoredPairs
                    .filter(pair => !diversePairs.some(dp => dp.baseToken.address === pair.baseToken.address))
                    .slice(0, remainingNeeded);
                
                resultPairs = [...diversePairs, ...additionalPairs];
            }
            
            // Take top 50 trending pairs
            const trendingPairs = resultPairs.slice(0, 50);
            
            // Update our tracking of returned tokens
            this.lastFetchedTokens = new Set(
                trendingPairs.map(pair => pair.baseToken.address)
            );
            
            logger.high(`Found ${trendingPairs.length} trending tokens`);
            return trendingPairs;
        } catch (error) {
            logger.error(`Failed to fetch trending tokens: ${error.message}`);
            
            // Fallback: try getting top volume pairs as a substitute
            try {
                const topVolumePairs = await this.getHighVolumeTokens();
                logger.deep(`Using ${topVolumePairs.length} high volume pairs as fallback for trending tokens`);
                return topVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback for trending tokens failed: ${fallbackError.message}`);
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
    
    // Get recently created tokens with rotating queries
    async getRecentTokens() {
        try {
            logger.high('Fetching recently created tokens');
            
            // Increment fetch counter
            this.fetchCounter++;
            
            const recentQueries = [
                'new solana',
                'launch solana',
                'recent solana',
                'today solana',
                'just launched solana'
            ];
            
            // Select a subset of queries based on the fetch counter
            const querySetSize = 3;
            const startIndex = (this.fetchCounter * querySetSize) % recentQueries.length;
            const selectedQueries = [];
            
            for (let i = 0; i < querySetSize; i++) {
                const index = (startIndex + i) % recentQueries.length;
                selectedQueries.push(recentQueries[index]);
            }
            
            logger.deep(`Using query set for recent tokens: ${selectedQueries.join(', ')}`);
            
            const allPairs = [];
            
            // Fetch results for each selected query
            for (const query of selectedQueries) {
                try {
                    const response = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/search`, {
                            params: { q: query }
                        })
                    );
                    
                    if (response.data && response.data.pairs) {
                        // Filter to only include Solana pairs
                        const solanaPairs = response.data.pairs.filter(pair => 
                            pair.chainId === 'solana' && pair.pairCreatedAt
                        );
                        
                        allPairs.push(...solanaPairs);
                        logger.deep(`Found ${solanaPairs.length} pairs for query "${query}"`);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch recent pairs for query "${query}": ${error.message}`);
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            // Sort by creation time (newest first)
            uniquePairs.sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
            
            // Filter out tokens we returned in the previous call to ensure diversity
            const previousTokens = new Set(this.lastFetchedTokens);
            const diversePairs = uniquePairs.filter(pair => 
                pair.baseToken?.address && !previousTokens.has(pair.baseToken.address)
            );
            
            // Take top 30 newest pairs
            const recentPairs = diversePairs.slice(0, 30);
            
            // Update our tracking with these tokens too
            for (const pair of recentPairs) {
                if (pair.baseToken?.address) {
                    this.lastFetchedTokens.add(pair.baseToken.address);
                }
            }
            
            logger.high(`Found ${recentPairs.length} recent tokens`);
            return recentPairs;
        } catch (error) {
            logger.error(`Failed to fetch recent tokens: ${error.message}`);
            
            // Fallback: try getting pairs from popular DEXes and sorting by creation time
            try {
                logger.deep('Trying fallback approach for recent tokens');
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
                
                // Filter to only include pairs with creation time
                const pairsWithCreationTime = allPairs.filter(pair => pair.pairCreatedAt);
                
                // Sort by creation time (newest first)
                pairsWithCreationTime.sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
                
                // Take top 30 newest pairs
                const fallbackRecentPairs = pairsWithCreationTime.slice(0, 30);
                
                logger.deep(`Found ${fallbackRecentPairs.length} recent tokens using fallback approach`);
                return fallbackRecentPairs;
            } catch (fallbackError) {
                logger.error(`Fallback approach for recent tokens failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Get high volume tokens with rotating queries
    async getHighVolumeTokens() {
        try {
            logger.high('Fetching high volume tokens');
            
            // Increment fetch counter
            this.fetchCounter++;
            
            const volumeQueries = [
                'volume solana',
                'high volume solana',
                'trading volume solana',
                'active solana'
            ];
            
            // Select a subset of queries based on the fetch counter
            const querySetSize = 2;
            const startIndex = (this.fetchCounter * querySetSize) % volumeQueries.length;
            const selectedQueries = [];
            
            for (let i = 0; i < querySetSize; i++) {
                const index = (startIndex + i) % volumeQueries.length;
                selectedQueries.push(volumeQueries[index]);
            }
            
            logger.deep(`Using query set for high volume tokens: ${selectedQueries.join(', ')}`);
            
            const allPairs = [];
            
            // Fetch results for each selected query
            for (const query of selectedQueries) {
                try {
                    const response = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/search`, {
                            params: { q: query }
                        })
                    );
                    
                    if (response.data && response.data.pairs) {
                        // Filter to only include Solana pairs with volume data
                        const solanaPairs = response.data.pairs.filter(pair => 
                            pair.chainId === 'solana' && pair.volume?.h24
                        );
                        
                        allPairs.push(...solanaPairs);
                        logger.deep(`Found ${solanaPairs.length} pairs for query "${query}"`);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch volume pairs for query "${query}": ${error.message}`);
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            // Sort by 24h volume (highest first)
            uniquePairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
            
            // Filter out tokens we returned in the previous call to ensure diversity
            const previousTokens = new Set(this.lastFetchedTokens);
            const diversePairs = uniquePairs.filter(pair => 
                pair.baseToken?.address && !previousTokens.has(pair.baseToken.address)
            );
            
            // Take top 30 highest volume pairs
            const volumePairs = diversePairs.slice(0, 30);
            
            // Update our tracking with these tokens too
            for (const pair of volumePairs) {
                if (pair.baseToken?.address) {
                    this.lastFetchedTokens.add(pair.baseToken.address);
                }
            }
            
            logger.high(`Found ${volumePairs.length} high volume tokens`);
            return volumePairs;
        } catch (error) {
            logger.error(`Failed to fetch high volume tokens: ${error.message}`);
            
            // Fallback: try getting all Solana pairs and sorting by volume
            try {
                logger.deep('Trying fallback approach for high volume tokens');
                const allPairs = await this.getSolanaPairs();
                
                // Filter to only include pairs with volume data
                const pairsWithVolume = allPairs.filter(pair => pair.volume?.h24);
                
                // Sort by 24h volume (highest first)
                pairsWithVolume.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
                
                // Take top 30 highest volume pairs
                const fallbackVolumePairs = pairsWithVolume.slice(0, 30);
                
                logger.deep(`Found ${fallbackVolumePairs.length} high volume tokens using fallback approach`);
                return fallbackVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback approach for high volume tokens failed: ${fallbackError.message}`);
                return [];
            }
        }
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
            
            // Filter out tokens we returned in the previous call to ensure diversity
            const previousTokens = new Set(this.lastFetchedTokens);
            const diversePairs = scoredPairs.filter(pair => 
                pair.baseToken?.address && !previousTokens.has(pair.baseToken.address)
            );
            
            // Take top 30 bullish pairs
            const bullishPairs = diversePairs.slice(0, 30);
            
            // Update our tracking with these tokens too
            for (const pair of bullishPairs) {
                if (pair.baseToken?.address) {
                    this.lastFetchedTokens.add(pair.baseToken.address);
                }
            }
            
            logger.deep(`Found ${bullishPairs.length} pairs with bullish sentiment`);
            return bullishPairs;
        } catch (error) {
            logger.error(`Failed to fetch bullish pairs: ${error.message}`);
            
            // Fallback: try getting recent pairs as a substitute
            try {
                const recentPairs = await this.getRecentTokens();
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
            
            // Filter out tokens we returned in the previous call to ensure diversity
            const previousTokens = new Set(this.lastFetchedTokens);
            const diversePairs = scoredPairs.filter(pair => 
                pair.baseToken?.address && !previousTokens.has(pair.baseToken.address)
            );
            
            // Take top 30 volume growth pairs
            const volumeGrowthPairs = diversePairs.slice(0, 30);
            
            // Update our tracking with these tokens too
            for (const pair of volumeGrowthPairs) {
                if (pair.baseToken?.address) {
                    this.lastFetchedTokens.add(pair.baseToken.address);
                }
            }
            
            logger.deep(`Found ${volumeGrowthPairs.length} pairs with high volume growth`);
            return volumeGrowthPairs;
        } catch (error) {
            logger.error(`Failed to fetch volume growth pairs: ${error.message}`);
            
            // Fallback: try getting top volume pairs as a substitute
            try {
                const topVolumePairs = await this.getHighVolumeTokens();
                logger.deep(`Using ${topVolumePairs.length} top volume pairs as fallback for volume growth pairs`);
                return topVolumePairs;
            } catch (fallbackError) {
                logger.error(`Fallback for volume growth pairs failed: ${fallbackError.message}`);
                return [];
            }
        }
    }
    
    // Comprehensive token discovery using data-driven metrics and rotating queries
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
            
            // 2. Get high volume tokens
            try {
                const highVolumePairs = await this.getHighVolumeTokens();
                this.addUniquePairs(allDiscoveredPairs, highVolumePairs);
                logger.deep(`Added ${this.countNewPairs(highVolumePairs)} new high volume pairs`);
            } catch (error) {
                logger.error(`Failed to get high volume tokens: ${error.message}`);
                discoverySuccess = false;
            }
            
            // 3. Get recent tokens
            try {
                const recentPairs = await this.getRecentTokens();
                this.addUniquePairs(allDiscoveredPairs, recentPairs);
                logger.deep(`Added ${this.countNewPairs(recentPairs)} new recent pairs`);
            } catch (error) {
                logger.error(`Failed to get recent tokens: ${error.message}`);
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
            
            // 6. Get pairs from top DEXes
            try {
                const popularDexes = await this.getPopularDexes();
                
                // Limit to top 5 DEXes to save API credits
                for (const dexId of popularDexes.slice(0, 5)) {
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
