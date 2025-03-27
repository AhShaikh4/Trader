const axios = require('axios');
const logger = require('./logger');
const moralisApi = require('./moralisApi');

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
        
        // Initialize Moralis
        this.moralisInitialized = false;
    }

    // Initialize Moralis if not already initialized
    async ensureMoralisInitialized() {
        if (!this.moralisInitialized) {
            await moralisApi.initMoralis();
            this.moralisInitialized = true;
        }
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
    
    // Get enhanced token information using Moralis API
    async getTokenInfo(tokenAddress) {
        try {
            if (!tokenAddress) {
                logger.error('Token address is required for getTokenInfo');
                return null;
            }
            
            const cacheKey = `moralis_info_${tokenAddress}`;
            const cachedInfo = this.getFromCache(cacheKey);
            
            if (cachedInfo) {
                logger.deep(`Using cached Moralis info for token ${tokenAddress}`);
                return cachedInfo;
            }
            
            logger.deep(`Fetching enhanced token info from Moralis for ${tokenAddress}`);
            
            // Ensure Moralis is initialized
            await this.ensureMoralisInitialized();
            
            // Get token metadata and price from Moralis
            const [metadata, price] = await Promise.all([
                moralisApi.getTokenMetadata('mainnet', tokenAddress),
                moralisApi.getTokenPrice('mainnet', tokenAddress)
            ]);
            
            if (!metadata && !price) {
                logger.error(`No Moralis data found for token ${tokenAddress}`);
                return null;
            }
            
            // Combine the data
            const tokenInfo = {
                address: tokenAddress,
                metadata: metadata || null,
                price: price || null,
                fetchedAt: new Date().toISOString()
            };
            
            // Cache the result
            this.cacheToken(cacheKey, tokenInfo);
            
            return tokenInfo;
        } catch (error) {
            logger.error(`Failed to get enhanced token info for ${tokenAddress}: ${error.message}`);
            return null;
        }
    }
    
    // Enhance token data with additional information from Moralis
    async enhanceTokenData(token) {
        if (!token || !token.baseToken || !token.baseToken.address) {
            return token;
        }
        
        const tokenAddress = token.baseToken.address;
        const enhancedInfo = await this.getTokenInfo(tokenAddress);
        
        if (!enhancedInfo) {
            return token;
        }
        
        // Add the enhanced information to the token
        return {
            ...token,
            moralisData: enhancedInfo
        };
    }
    
    // Get enhanced token pools with additional information
    async getEnhancedTokenPools(tokenAddress) {
        const pools = await this.getTokenPools(tokenAddress);
        
        if (pools.length === 0) {
            return [];
        }
        
        // Get enhanced token info
        const tokenInfo = await this.getTokenInfo(tokenAddress);
        
        // Add the enhanced information to each pool
        return pools.map(pool => ({
            ...pool,
            moralisData: tokenInfo
        }));
    }
    
    // Discover tokens with comprehensive approach
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive token discovery');
            
            // Get trending and new tokens
            const [trendingTokens, newTokens] = await Promise.all([
                this.getTrendingTokens(),
                this.getNewTokens()
            ]);
            
            // Combine and deduplicate tokens
            const allTokens = [...trendingTokens, ...newTokens];
            const uniqueTokens = Array.from(
                new Map(allTokens.map(token => [token.baseToken?.address, token])).values()
            );
            
            // Filter out tokens with insufficient liquidity
            const validTokens = uniqueTokens.filter(token => 
                token.liquidity?.usd >= this.minLiquidity
            );
            
            // Calculate a discovery score for each token
            const scoredTokens = await Promise.all(validTokens.map(async token => {
                // Base metrics
                const volumeToLiquidity = token.volume?.h24 / token.liquidity?.usd || 0;
                const priceChangeScore = Math.abs(token.priceChange?.h24 || 0);
                const ageInHours = token.pairCreatedAt ? 
                    (Date.now() - new Date(token.pairCreatedAt).getTime()) / (1000 * 60 * 60) : 
                    1000; // Default to old if no creation date
                
                // Age factor (newer tokens get higher score)
                const ageFactor = Math.max(0, 1 - (ageInHours / (7 * 24))); // 0-1 scale, 0 for week-old tokens
                
                // Trending factor
                const trendingFactor = token.trendingScore ? Math.min(1, token.trendingScore / 100) : 0;
                
                // Calculate base score
                let score = (volumeToLiquidity * 40) + (priceChangeScore / 10) + (ageFactor * 30) + (trendingFactor * 30);
                
                // Determine discovery reasons
                const reasons = [];
                if (trendingFactor > 0.3) reasons.push('Trending');
                if (ageFactor > 0.7) reasons.push('New');
                if (volumeToLiquidity > 0.5) reasons.push('High Volume');
                if (priceChangeScore > 5) reasons.push('Price Movement');
                
                // Get enhanced token info if available
                let enhancedInfo = null;
                try {
                    enhancedInfo = await this.getTokenInfo(token.baseToken?.address);
                    
                    // Boost score if we have additional information
                    if (enhancedInfo) {
                        score += 10;
                        reasons.push('Enhanced Data Available');
                    }
                } catch (error) {
                    logger.error(`Error getting enhanced info for ${token.baseToken?.symbol}: ${error.message}`);
                }
                
                return {
                    address: token.baseToken?.address,
                    symbol: token.baseToken?.symbol,
                    name: token.baseToken?.name,
                    price: token.priceUsd,
                    liquidity: token.liquidity?.usd,
                    volume24h: token.volume?.h24,
                    priceChange24h: token.priceChange?.h24,
                    dexId: token.dexId,
                    pairAddress: token.pairAddress,
                    createdAt: token.pairCreatedAt,
                    score,
                    reasons,
                    metrics: {
                        volumeToLiquidity,
                        priceChangeScore,
                        ageInHours,
                        ageFactor,
                        trendingFactor
                    },
                    moralisData: enhancedInfo
                };
            }));
            
            // Sort by score (highest first)
            scoredTokens.sort((a, b) => b.score - a.score);
            
            logger.high(`Discovered ${scoredTokens.length} tokens with comprehensive approach`);
            return scoredTokens;
        } catch (error) {
            logger.error(`Failed to discover tokens: ${error.message}`);
            return [];
        }
    }
}

// Create and export a singleton instance
const dexScreenerDirect = new DexScreenerDirect();
module.exports = dexScreenerDirect;
