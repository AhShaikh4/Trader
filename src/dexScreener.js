const axios = require('axios');
const logger = require('./logger');

class DexScreenerDirect {
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
        this.requestsPerMinute = 250; // Keep below the 300 limit for safety
        this.requestTimestamps = [];
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
            // This is more reliable than trying to use a direct DEX endpoint
            const response = await this.queueRequest(() => 
                axios.get(`${this.baseUrl}/search`, {
                    params: {
                        q: `${dexId} solana`
                    }
                })
            );
            
            if (!response.data || !response.data.pairs) {
                logger.error(`Invalid response format from DEX ${dexId}`);
                return [];
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
                return [];
            }
            
            const pools = response.data;
            
            logger.deep(`Found ${pools.length} pools for token ${tokenAddress}`);
            
            // Cache the result
            this.cacheToken(cacheKey, pools);
            
            return pools;
        } catch (error) {
            logger.error(`Failed to fetch pools for token ${tokenAddress}: ${error.message}`);
            return [];
        }
    }
    
    // Get trending tokens based on volume and price change
    async getTrendingTokens() {
        try {
            logger.high('Fetching trending tokens based on volume and price change');
            
            // Use the search endpoint with trending-related queries
            const trendingQueries = [
                'trending solana',
                'new solana',
                'volume solana',
                'pump solana'
            ];
            
            const allPairs = [];
            
            // Fetch results for each trending query
            for (const query of trendingQueries) {
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
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            // Filter out pairs with insufficient data
            const validPairs = uniquePairs.filter(pair => 
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
            logger.error(`Failed to get trending tokens: ${error.message}`);
            return [];
        }
    }
    
    // Get new tokens based on creation date
    async getNewTokens() {
        try {
            logger.high('Fetching new tokens based on creation date');
            
            // Use the search endpoint with new-related queries
            const newQueries = [
                'new solana',
                'launch solana',
                'just launched solana',
                'today solana'
            ];
            
            const allPairs = [];
            
            // Fetch results for each new query
            for (const query of newQueries) {
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
                    logger.error(`Failed to fetch new pairs for query "${query}": ${error.message}`);
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            // Filter to only include pairs created in the last 7 days
            const newPairs = uniquePairs.filter(pair => {
                if (!pair.pairCreatedAt) return false;
                
                const pairAge = Date.now() - new Date(pair.pairCreatedAt).getTime();
                return pairAge <= this.maxPairAge;
            });
            
            // Sort by creation date (newest first)
            newPairs.sort((a, b) => 
                new Date(b.pairCreatedAt).getTime() - new Date(a.pairCreatedAt).getTime()
            );
            
            logger.high(`Found ${newPairs.length} new tokens`);
            return newPairs;
        } catch (error) {
            logger.error(`Failed to get new tokens: ${error.message}`);
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
    
    // Filter pairs based on criteria
    filterPairs(pairs, strictMode = true) {
        // Base filtering that applies to all modes
        let filteredPairs = pairs.filter(pair => {
            if (!pair.chainId || !pair.liquidity?.usd) {
                return false;
            }
            
            return pair.chainId === 'solana';
        });
        
        // If we have too few results, use less strict filtering
        if (filteredPairs.length < 10 && strictMode) {
            logger.deep(`Few results with strict filtering (${filteredPairs.length}), applying relaxed criteria`);
            return this.filterPairs(pairs, false);
        }
        
        // Apply liquidity filtering based on mode
        if (strictMode) {
            filteredPairs = filteredPairs.filter(pair => 
                pair.liquidity.usd >= this.minLiquidity
            );
        } else {
            // Relaxed mode - lower liquidity requirement
            filteredPairs = filteredPairs.filter(pair => {
                const pairAge = pair.pairCreatedAt ? 
                    (Date.now() - new Date(pair.pairCreatedAt).getTime()) : 
                    Infinity;
                    
                const isNew = pairAge <= 24 * 60 * 60 * 1000;
                
                return (isNew && pair.liquidity.usd >= this.minLiquidity / 4) || 
                       (!isNew && pair.liquidity.usd >= this.minLiquidity / 2);
            });
        }
        
        return filteredPairs;
    }
    
    // Analyze token based on its metrics
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

            // Calculate metrics
            analysis.metrics.volumeToLiquidity = analysis.volume24h / analysis.liquidity;
            analysis.metrics.ageInHours = pair.pairCreatedAt ? 
                (new Date().getTime() - new Date(analysis.createdAt).getTime()) / (60 * 60 * 1000) : 
                Infinity;
            
            // Liquidity scoring (0-3 points)
            if (analysis.liquidity >= this.minLiquidity) {
                const liquidityScore = Math.min(3, Math.floor(analysis.liquidity / 10000));
                analysis.score += liquidityScore;
                analysis.reasons.push(`Liquidity score: ${liquidityScore}`);
            }

            // Volume/Liquidity ratio scoring (0-3 points)
            if (analysis.metrics.volumeToLiquidity >= 0.5) {
                const vlRatio = analysis.metrics.volumeToLiquidity;
                const vlScore = Math.min(3, Math.floor(vlRatio / 3));
                analysis.score += vlScore;
                analysis.reasons.push(`Volume/Liquidity ratio score: ${vlScore}`);
            }

            // Price change scoring (0-3 points)
            if (analysis.priceChange24h > 0) {
                const priceScore = Math.min(3, Math.floor(analysis.priceChange24h / 20));
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
                    ageInHours: Math.floor(analysis.metrics.ageInHours)
                }
            }, null, 2));

            return analysis;
        } catch (error) {
            logger.error(`Token analysis failed: ${error.message}`);
            return null;
        }
    }
    
    // Comprehensive token discovery using multiple approaches
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive token discovery using direct API approach');
            
            const allTokens = new Set();
            
            // 1. Get trending tokens
            const trendingPairs = await this.getTrendingTokens();
            trendingPairs.forEach(pair => {
                if (pair.baseToken?.address) {
                    allTokens.add(pair.baseToken.address);
                }
            });
            
            // 2. Get new tokens
            const newPairs = await this.getNewTokens();
            newPairs.forEach(pair => {
                if (pair.baseToken?.address) {
                    allTokens.add(pair.baseToken.address);
                }
            });
            
            // 3. Get tokens from popular DEXes
            const popularDexes = await this.getPopularDexes();
            for (const dex of popularDexes.slice(0, 5)) { // Limit to top 5 DEXes to avoid rate limits
                const dexPairs = await this.getPairsFromDex(dex);
                dexPairs.forEach(pair => {
                    if (pair.baseToken?.address) {
                        allTokens.add(pair.baseToken.address);
                    }
                });
            }
            
            logger.high(`Discovered ${allTokens.size} unique tokens`);
            
            // Convert to pairs for analysis
            const tokenPairs = [];
            for (const tokenAddress of allTokens) {
                // Check cache first
                let pairData = this.getFromCache(`token_${tokenAddress}`);
                
                if (!pairData) {
                    // Try to find this token in our existing pairs
                    pairData = [...trendingPairs, ...newPairs].find(
                        pair => pair.baseToken?.address === tokenAddress
                    );
                    
                    if (!pairData) {
                        // Get pools for this token
                        const pools = await this.getTokenPools(tokenAddress);
                        
                        if (pools && pools.length > 0) {
                            // Use the pool with highest liquidity
                            pairData = pools.sort((a, b) => 
                                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
                            )[0];
                        }
                    }
                    
                    if (pairData) {
                        // Cache the result
                        this.cacheToken(`token_${tokenAddress}`, pairData);
                    }
                }
                
                if (pairData) {
                    tokenPairs.push(pairData);
                }
            }
            
            // Apply filtering
            const filteredPairs = this.filterPairs(tokenPairs, true);
            
            // Sort by score
            const analyzedPairs = [];
            for (const pair of filteredPairs) {
                const analysis = this.analyzeToken(pair);
                if (analysis) {
                    analyzedPairs.push(analysis);
                }
            }
            
            // Sort by score descending
            const topTokens = analyzedPairs
                .sort((a, b) => b.score - a.score)
                .slice(0, 20);
            
            logger.high(`Found ${topTokens.length} promising tokens`);
            return topTokens;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            return [];
        }
    }
}

// Create and export a singleton instance
const dexScreenerDirect = new DexScreenerDirect();
module.exports = dexScreenerDirect;
