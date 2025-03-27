// Consolidated API module for Trader project
// This file combines functionality from multiple API modules

const axios = require('axios');
const logger = require('./logger');
const moralisApi = require('./moralisApi');

class TraderAPI {
    constructor() {
        // DexScreener configuration
        this.dexScreenerBaseUrl = 'https://api.dexscreener.com/latest/dex';
        this.dexScreenerTokenPairsUrl = 'https://api.dexscreener.com/token-pairs/v1';
        this.minLiquidity = 3000; // $3,000 minimum liquidity
        this.maxPairAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        // Birdeye configuration
        this.birdeyeBaseUrl = 'https://public-api.birdeye.so';
        this.birdeyeApiKey = process.env.BIRDEYE_API_KEY;
        
        // Jupiter configuration
        this.jupiterBaseUrl = 'https://price.jup.ag/v4';
        
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

    // DexScreener methods
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
                axios.get(`${this.dexScreenerTokenPairsUrl}/solana/${tokenAddress}`)
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

    // Birdeye methods
    async getTokenMetadata(tokenAddress) {
        try {
            if (!tokenAddress) {
                logger.error('Token address is required for getTokenMetadata');
                return null;
            }
            
            const cacheKey = `birdeye_metadata_${tokenAddress}`;
            const cachedMetadata = this.getFromCache(cacheKey);
            
            if (cachedMetadata) {
                logger.deep(`Using cached Birdeye metadata for token ${tokenAddress}`);
                return cachedMetadata;
            }
            
            logger.deep(`Fetching token metadata from Birdeye for ${tokenAddress}`);
            
            const response = await this.queueRequest(() => 
                axios.get(`${this.birdeyeBaseUrl}/public/tokenlist/detail?address=${tokenAddress}`, {
                    headers: {
                        'X-API-KEY': this.birdeyeApiKey
                    }
                })
            );
            
            if (!response.data || !response.data.data) {
                logger.error(`Invalid response format from Birdeye for token ${tokenAddress}`);
                return null;
            }
            
            const metadata = response.data.data;
            
            // Cache the result
            this.cacheToken(cacheKey, metadata);
            
            return metadata;
        } catch (error) {
            logger.error(`Failed to get token metadata from Birdeye: ${error.message}`);
            return null;
        }
    }

    // Jupiter methods
    async getTokenPrice(tokenAddress) {
        try {
            if (!tokenAddress) {
                logger.error('Token address is required for getTokenPrice');
                return null;
            }
            
            const cacheKey = `jupiter_price_${tokenAddress}`;
            const cachedPrice = this.getFromCache(cacheKey);
            
            if (cachedPrice) {
                logger.deep(`Using cached Jupiter price for token ${tokenAddress}`);
                return cachedPrice;
            }
            
            logger.deep(`Fetching token price from Jupiter for ${tokenAddress}`);
            
            const response = await this.queueRequest(() => 
                axios.get(`${this.jupiterBaseUrl}/price?ids=${tokenAddress}`)
            );
            
            if (!response.data || !response.data.data || !response.data.data[tokenAddress]) {
                logger.error(`Invalid response format from Jupiter for token ${tokenAddress}`);
                return null;
            }
            
            const priceData = response.data.data[tokenAddress];
            
            // Cache the result
            this.cacheToken(cacheKey, priceData);
            
            return priceData;
        } catch (error) {
            logger.error(`Failed to get token price from Jupiter: ${error.message}`);
            return null;
        }
    }

    // Moralis methods
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

    // Token discovery methods
    async getAllPairsFromPopularDexes() {
        try {
            logger.high('Fetching all pairs from popular DEXes without search queries');
            
            const cacheKey = 'all_dex_pairs';
            const cachedPairs = this.getFromCache(cacheKey);
            
            if (cachedPairs) {
                logger.deep('Using cached pairs from all DEXes');
                return cachedPairs;
            }
            
            // Get list of popular DEXes
            const popularDexes = await this.getPopularDexes();
            logger.deep(`Found ${popularDexes.length} popular DEXes to scan`);
            
            // Collect pairs from each DEX
            const allPairs = [];
            
            // Use the pairs endpoint for each DEX
            for (const dexId of popularDexes) {
                try {
                    logger.deep(`Fetching pairs from DEX ${dexId}`);
                    
                    // Use the pairs endpoint with the DEX ID
                    const response = await this.queueRequest(() => 
                        axios.get(`${this.dexScreenerBaseUrl}/pairs/solana/${dexId}`)
                    );
                    
                    if (response.data && response.data.pairs) {
                        const pairs = response.data.pairs;
                        logger.deep(`Found ${pairs.length} pairs on DEX ${dexId}`);
                        allPairs.push(...pairs);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch pairs from DEX ${dexId}: ${error.message}`);
                }
            }
            
            logger.high(`Found ${allPairs.length} total pairs from all DEXes`);
            
            // Cache the result
            this.cacheToken(cacheKey, allPairs);
            
            return allPairs;
        } catch (error) {
            logger.error(`Failed to fetch all pairs from popular DEXes: ${error.message}`);
            return [];
        }
    }

    // Calculate age in hours
    getAgeInHours(timestamp) {
        const created = new Date(timestamp);
        const now = new Date();
        const diffMs = now - created;
        const diffHours = diffMs / (1000 * 60 * 60);
        return diffHours;
    }

    async getRecentTokens() {
        try {
            logger.high('Fetching recent tokens without search queries');
            
            // Get all pairs from popular DEXes
            const allPairs = await this.getAllPairsFromPopularDexes();
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            logger.deep(`Found ${uniquePairs.length} unique pairs after removing duplicates`);
            
            // Filter to only include pairs created in the last 24 hours
            const recentPairs = uniquePairs.filter(pair => {
                if (!pair.pairCreatedAt) return false;
                
                const pairAge = Date.now() - new Date(pair.pairCreatedAt).getTime();
                return pairAge <= this.maxPairAge;
            });
            
            // Sort by creation date (newest first)
            recentPairs.sort((a, b) => 
                new Date(b.pairCreatedAt).getTime() - new Date(a.pairCreatedAt).getTime()
            );
            
            logger.high(`Found ${recentPairs.length} tokens created in the last 24 hours`);
            
            return recentPairs;
        } catch (error) {
            logger.error(`Failed to get recent tokens: ${error.message}`);
            return [];
        }
    }

    // Enhance token data with additional information
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

    // Discover tokens with comprehensive approach
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive token discovery');
            
            // Get recent tokens
            const recentTokens = await this.getRecentTokens();
            
            // Apply criteria to filter tokens
            const filteredTokens = recentTokens.filter(token => {
                // Must have minimum liquidity
                if (!token.liquidity || !token.liquidity.usd || parseFloat(token.liquidity.usd) < this.minLiquidity) {
                    return false;
                }
                
                return true;
            });
            
            // Enhance tokens with additional data
            const enhancedTokens = await Promise.all(
                filteredTokens.map(async (token) => {
                    try {
                        return await this.enhanceTokenData(token);
                    } catch (error) {
                        logger.error(`Failed to enhance token data: ${error.message}`);
                        return token;
                    }
                })
            );
            
            // Calculate a discovery score for each token
            const scoredTokens = enhancedTokens.map(token => {
                // Base metrics
                const volumeToLiquidity = token.volume?.h24 / token.liquidity?.usd || 0;
                const priceChangeScore = Math.abs(token.priceChange?.h24 || 0);
                const ageInHours = this.getAgeInHours(token.pairCreatedAt);
                
                // Age factor (newer tokens get higher score)
                const ageFactor = Math.max(0, 1 - (ageInHours / 24)); // 0-1 scale, 0 for 24-hour-old tokens
                
                // Calculate base score
                let score = (volumeToLiquidity * 40) + (priceChangeScore / 10) + (ageFactor * 30);
                
                // Determine discovery reasons
                const reasons = [];
                if (ageInHours < 1) reasons.push('Very Recent');
                if (volumeToLiquidity > 0.5) reasons.push('High Volume');
                if (priceChangeScore > 5) reasons.push('Price Movement');
                
                // Boost score if we have additional information
                if (token.moralisData) {
                    score += 10;
                    reasons.push('Enhanced Data Available');
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
                        ageFactor
                    },
                    moralisData: token.moralisData,
                    originalToken: token
                };
            });
            
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
const traderAPI = new TraderAPI();
module.exports = traderAPI;
