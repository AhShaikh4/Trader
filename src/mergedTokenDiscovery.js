const axios = require('axios');
const logger = require('./logger');
const moralisApi = require('./moralisApi');

class MergedTokenDiscovery {
    constructor() {
        this.baseUrl = 'https://api.dexscreener.com/latest/dex';
        this.tokenPairsUrl = 'https://api.dexscreener.com/token-pairs/v1';
        this.minLiquidity = 3000; // $3,000 minimum liquidity
        this.maxPairAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.veryRecentThreshold = 1 * 60 * 60 * 1000; // 1 hour in milliseconds
        
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
        
        // Criteria for token discovery
        this.criteria = {
            veryRecent: { // For tokens < 1 hour old
                minPriceChangeM5: 1,    // 1%
                minVolumeM5: 500,       // $500
                minLiquidityUsd: 3000   // $3,000
            },
            recent: { // For tokens 1-24 hours old
                minPriceChangeH1: 5,    // 5%
                minVolumeH1: 5000,      // $5,000
                minLiquidityUsd: 3000   // $3,000
            }
        };
        
        // Fallback criteria
        this.fallbackCriteria = {
            veryRecent: {
                minPriceChangeM5: 0.5,  // 0.5%
                minVolumeM5: 100,       // $100
                minLiquidityUsd: 1000   // $1,000
            },
            recent: {
                minPriceChangeH1: 2,    // 2%
                minVolumeH1: 1000,      // $1,000
                minLiquidityUsd: 1000   // $1,000
            }
        };
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

    // Get all pairs from all popular DEXes without using search queries
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
            
            // Instead of using search queries, we'll use the /pairs endpoint for each DEX
            for (const dexId of popularDexes) {
                try {
                    logger.deep(`Fetching pairs from DEX ${dexId}`);
                    
                    // Use the pairs endpoint with the DEX ID
                    const response = await this.queueRequest(() => 
                        axios.get(`${this.baseUrl}/pairs/solana/${dexId}`)
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

    // Get recent tokens without using search queries
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

    // Apply age-based buying criteria
    applyAgeBuyingCriteria(tokens, useFallback = false) {
        const criteriaSet = useFallback ? this.fallbackCriteria : this.criteria;
        
        logger.high(`Applying ${useFallback ? 'fallback' : 'primary'} age-based buying criteria...`);
        
        if (useFallback) {
            logger.high('Using relaxed criteria thresholds:');
            logger.high(`Very Recent (<1h): m5 change > ${criteriaSet.veryRecent.minPriceChangeM5}%, m5 volume > $${criteriaSet.veryRecent.minVolumeM5}, liquidity > $${criteriaSet.veryRecent.minLiquidityUsd}`);
            logger.high(`Recent (1-24h): h1 change > ${criteriaSet.recent.minPriceChangeH1}%, h1 volume > $${criteriaSet.recent.minVolumeH1}, liquidity > $${criteriaSet.recent.minLiquidityUsd}`);
        }
        
        const buyDecisions = tokens.map(token => {
            // Calculate age in hours
            const ageInMs = Date.now() - new Date(token.pairCreatedAt).getTime();
            const ageHours = ageInMs / (1000 * 60 * 60);
            
            // Determine which criteria to apply based on age
            const isVeryRecent = ageInMs < this.veryRecentThreshold;
            const criteria = isVeryRecent ? criteriaSet.veryRecent : criteriaSet.recent;
            
            // Initialize decision object
            const decision = {
                token,
                ageHours,
                isVeryRecent,
                appliedCriteria: isVeryRecent ? 'Very Recent (<1h)' : 'Recent (1-24h)',
                criteriaLevel: useFallback ? 'Fallback' : 'Primary',
                checks: {},
                buyDecision: false
            };
            
            // Apply criteria based on token age
            if (isVeryRecent) {
                // For tokens less than 1 hour old
                decision.checks.priceChangeM5 = token.priceChange && token.priceChange.m5 > criteria.minPriceChangeM5;
                decision.checks.volumeM5 = token.volume && token.volume.m5 && parseFloat(token.volume.m5) > criteria.minVolumeM5;
                decision.checks.liquidity = token.liquidity && token.liquidity.usd && parseFloat(token.liquidity.usd) > criteria.minLiquidityUsd;
                
                // All criteria must be met
                decision.buyDecision = decision.checks.priceChangeM5 && decision.checks.volumeM5 && decision.checks.liquidity;
                
                // Add detailed metrics for debugging
                decision.metrics = {
                    priceChangeM5: token.priceChange?.m5 || 'N/A',
                    volumeM5: token.volume?.m5 || 'N/A',
                    liquidity: token.liquidity?.usd || 'N/A'
                };
            } else {
                // For tokens 1-24 hours old
                decision.checks.priceChangeH1 = token.priceChange && token.priceChange.h1 > criteria.minPriceChangeH1;
                decision.checks.volumeH1 = token.volume && token.volume.h1 && parseFloat(token.volume.h1) > criteria.minVolumeH1;
                decision.checks.liquidity = token.liquidity && token.liquidity.usd && parseFloat(token.liquidity.usd) > criteria.minLiquidityUsd;
                
                // All criteria must be met
                decision.buyDecision = decision.checks.priceChangeH1 && decision.checks.volumeH1 && decision.checks.liquidity;
                
                // Add detailed metrics for debugging
                decision.metrics = {
                    priceChangeH1: token.priceChange?.h1 || 'N/A',
                    volumeH1: token.volume?.h1 || 'N/A',
                    liquidity: token.liquidity?.usd || 'N/A'
                };
            }
            
            return decision;
        });
        
        // Filter to only include positive buy decisions
        const positiveBuyDecisions = buyDecisions.filter(decision => decision.buyDecision);
        
        logger.high(`Found ${positiveBuyDecisions.length} tokens meeting the ${useFallback ? 'fallback' : 'primary'} buying criteria`);
        
        return {
            all: buyDecisions,
            buy: positiveBuyDecisions
        };
    }

    // Discover tokens with comprehensive approach without search queries
    async discoverTokens() {
        try {
            logger.high('Starting comprehensive token discovery without search queries');
            
            // Get recent tokens without using search queries
            const recentTokens = await this.getRecentTokens();
            
            // Apply primary criteria
            const primaryDecisions = this.applyAgeBuyingCriteria(recentTokens, false);
            
            // If no tokens meet primary criteria, try fallback criteria
            let finalBuyDecisions = primaryDecisions.buy;
            
            if (finalBuyDecisions.length === 0 && this.fallbackCriteria) {
                logger.high('No tokens met primary criteria, trying fallback criteria...');
                const fallbackDecisions = this.applyAgeBuyingCriteria(recentTokens, true);
                finalBuyDecisions = fallbackDecisions.buy;
            }
            
            // Enhance buy decisions with Moralis data
            const enhancedBuyDecisions = await Promise.all(
                finalBuyDecisions.map(async (decision) => {
                    try {
                        const enhancedToken = await this.enhanceTokenData(decision.token);
                        return {
                            ...decision,
                            token: enhancedToken
                        };
                    } catch (error) {
                        logger.error(`Failed to enhance token data: ${error.message}`);
                        return decision;
                    }
                })
            );
            
            // Calculate a discovery score for each token
            const scoredTokens = enhancedBuyDecisions.map(decision => {
                const token = decision.token;
                
                // Base metrics
                const volumeToLiquidity = token.volume?.h24 / token.liquidity?.usd || 0;
                const priceChangeScore = Math.abs(token.priceChange?.h24 || 0);
                const ageInHours = decision.ageHours;
                
                // Age factor (newer tokens get higher score)
                const ageFactor = Math.max(0, 1 - (ageInHours / 24)); // 0-1 scale, 0 for 24-hour-old tokens
                
                // Calculate base score
                let score = (volumeToLiquidity * 40) + (priceChangeScore / 10) + (ageFactor * 30);
                
                // Determine discovery reasons
                const reasons = [];
                if (decision.isVeryRecent) reasons.push('Very Recent');
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
                    decision: decision
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
const mergedTokenDiscovery = new MergedTokenDiscovery();
module.exports = mergedTokenDiscovery;
