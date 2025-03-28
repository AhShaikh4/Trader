const logger = require('./logger');
const dexscreener = require('./dexscreener');
const birdeye = require('./birdeye');
const moralis = require('./moralis');

class FetchAnalyzeModule {
    constructor() {
        // Cache implementation
        this.tokenCache = new Map();
        this.cacheExpiryTime = 30 * 60 * 1000; // 30 minutes
        
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
        
        // Initialize Moralis
        this.moralisInitialized = false;
    }

    // Initialize Moralis if not already initialized
    async ensureMoralisInitialized() {
        if (!this.moralisInitialized) {
            await moralis.initMoralis();
            this.moralisInitialized = true;
        }
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
                moralis.getTokenMetadata('mainnet', tokenAddress),
                moralis.getTokenPrice('mainnet', tokenAddress)
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

    // Get trending tokens from DexScreener
    async getTrendingTokens() {
        try {
            logger.high('Fetching trending tokens from DexScreener');
            return await dexscreener.getTrendingTokens();
        } catch (error) {
            logger.error(`Failed to fetch trending tokens: ${error.message}`);
            return [];
        }
    }

    // Get token pools from DexScreener
    async getTokenPools(tokenAddress) {
        try {
            logger.high(`Fetching token pools for ${tokenAddress} from DexScreener`);
            return await dexscreener.getTokenPools(tokenAddress);
        } catch (error) {
            logger.error(`Failed to fetch token pools: ${error.message}`);
            return [];
        }
    }

    // Analyze token using Birdeye
    async analyzeTokenWithBirdeye(tokenAddress) {
        try {
            logger.high(`Analyzing token ${tokenAddress} with Birdeye`);
            return await birdeye.analyzeToken(tokenAddress);
        } catch (error) {
            logger.error(`Failed to analyze token with Birdeye: ${error.message}`);
            return null;
        }
    }

    // Comprehensive token analysis using multiple sources
    async comprehensiveTokenAnalysis(tokenAddress) {
        try {
            logger.high(`Starting comprehensive analysis for token ${tokenAddress}`);
            
            // Get data from multiple sources in parallel
            const [birdeyeAnalysis, dexscreenerPools, moralisInfo] = await Promise.all([
                this.analyzeTokenWithBirdeye(tokenAddress),
                this.getTokenPools(tokenAddress),
                this.getTokenInfo(tokenAddress)
            ]);
            
            // Combine the data
            const analysis = {
                address: tokenAddress,
                timestamp: new Date().toISOString(),
                birdeye: birdeyeAnalysis || null,
                dexscreener: {
                    pools: dexscreenerPools || []
                },
                moralis: moralisInfo || null
            };
            
            // Add some derived metrics
            if (birdeyeAnalysis && birdeyeAnalysis.price) {
                analysis.price = birdeyeAnalysis.price;
            }
            
            if (dexscreenerPools && dexscreenerPools.length > 0) {
                analysis.dexCount = new Set(dexscreenerPools.map(pool => pool.dexId)).size;
                analysis.poolCount = dexscreenerPools.length;
            }
            
            logger.high(`Completed comprehensive analysis for ${tokenAddress}`);
            return analysis;
        } catch (error) {
            logger.error(`Comprehensive token analysis failed: ${error.message}`);
            return null;
        }
    }

    // Discover new tokens based on criteria
    async discoverNewTokens() {
        try {
            logger.high('Starting token discovery process');
            
            // Get popular DEXes
            const popularDexes = await dexscreener.getPopularDexes();
            logger.deep(`Found ${popularDexes.length} popular DEXes`);
            
            const allPairs = [];
            const now = Date.now();
            
            // Fetch pairs from each DEX
            for (const dexId of popularDexes.slice(0, 5)) { // Limit to top 5 DEXes to save API credits
                try {
                    const pairs = await dexscreener.getPairsFromDex(dexId);
                    
                    // Filter pairs by age
                    const recentPairs = pairs.filter(pair => {
                        if (!pair.pairCreatedAt) return false;
                        const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                        return pairAge <= 24 * 60 * 60 * 1000; // 24 hours
                    });
                    
                    allPairs.push(...recentPairs);
                    logger.deep(`Found ${recentPairs.length} recent pairs on DEX ${dexId}`);
                } catch (error) {
                    logger.error(`Failed to fetch pairs from DEX ${dexId}: ${error.message}`);
                }
            }
            
            // Deduplicate pairs by base token address
            const uniquePairs = Array.from(
                new Map(allPairs.map(pair => [pair.baseToken?.address, pair])).values()
            );
            
            logger.deep(`Found ${uniquePairs.length} unique token pairs`);
            
            // Apply discovery criteria
            const discoveredTokens = [];
            
            for (const pair of uniquePairs) {
                try {
                    const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                    const isVeryRecent = pairAge <= this.criteria.veryRecent.minLiquidityUsd;
                    
                    // Apply appropriate criteria based on token age
                    const criteria = isVeryRecent ? this.criteria.veryRecent : this.criteria.recent;
                    
                    // Check if the pair meets the criteria
                    if (
                        pair.liquidity?.usd >= criteria.minLiquidityUsd &&
                        ((isVeryRecent && Math.abs(pair.priceChange?.m5 || 0) >= criteria.minPriceChangeM5 && pair.volume?.m5 >= criteria.minVolumeM5) ||
                         (!isVeryRecent && Math.abs(pair.priceChange?.h1 || 0) >= criteria.minPriceChangeH1 && pair.volume?.h1 >= criteria.minVolumeH1))
                    ) {
                        // Enhance with Moralis data
                        const enhancedToken = await this.enhanceTokenData(pair);
                        discoveredTokens.push(enhancedToken);
                        
                        logger.token(`Discovered token: ${pair.baseToken?.name || pair.baseToken?.symbol} (${pair.baseToken?.address})`);
                    }
                } catch (error) {
                    logger.error(`Error processing pair ${pair.baseToken?.address}: ${error.message}`);
                }
            }
            
            // If we didn't find enough tokens, try with fallback criteria
            if (discoveredTokens.length < 5) {
                logger.deep(`Found only ${discoveredTokens.length} tokens, trying with fallback criteria`);
                
                for (const pair of uniquePairs) {
                    // Skip tokens we've already discovered
                    if (discoveredTokens.some(token => token.baseToken?.address === pair.baseToken?.address)) {
                        continue;
                    }
                    
                    try {
                        const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                        const isVeryRecent = pairAge <= this.fallbackCriteria.veryRecent.minLiquidityUsd;
                        
                        // Apply appropriate fallback criteria based on token age
                        const criteria = isVeryRecent ? this.fallbackCriteria.veryRecent : this.fallbackCriteria.recent;
                        
                        // Check if the pair meets the fallback criteria
                        if (
                            pair.liquidity?.usd >= criteria.minLiquidityUsd &&
                            ((isVeryRecent && Math.abs(pair.priceChange?.m5 || 0) >= criteria.minPriceChangeM5 && pair.volume?.m5 >= criteria.minVolumeM5) ||
                             (!isVeryRecent && Math.abs(pair.priceChange?.h1 || 0) >= criteria.minPriceChangeH1 && pair.volume?.h1 >= criteria.minVolumeH1))
                        ) {
                            // Enhance with Moralis data
                            const enhancedToken = await this.enhanceTokenData(pair);
                            discoveredTokens.push(enhancedToken);
                            
                            logger.token(`Discovered token (fallback): ${pair.baseToken?.name || pair.baseToken?.symbol} (${pair.baseToken?.address})`);
                            
                            // Stop if we've found enough tokens
                            if (discoveredTokens.length >= 10) {
                                break;
                            }
                        }
                    } catch (error) {
                        logger.error(`Error processing pair with fallback criteria ${pair.baseToken?.address}: ${error.message}`);
                    }
                }
            }
            
            logger.high(`Token discovery complete. Found ${discoveredTokens.length} tokens`);
            return discoveredTokens;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            return [];
        }
    }
}

const fetchAnalyze = new FetchAnalyzeModule();
module.exports = fetchAnalyze;
