const logger = require('./logger');
const dexscreener = require('./dexscreener');
const birdeye = require('./birdeye');
const moralis = require('./moralis');

class FetchAnalyzeModule {
    constructor() {
        // Cache implementation
        this.tokenCache = new Map();
        this.cacheExpiryTime = 30 * 60 * 1000; // 30 minutes
        this.discoveredTokensHistory = new Set(); // Track previously discovered tokens
        
        // Multi-pass discovery criteria
        this.criteria = {
            highPotential: { // First pass - strict criteria for high potential tokens
                minLiquidityUsd: 10000,   // $10K
                maxLiquidityUsd: 500000,  // $500K - sweet spot
                minPriceChangeH1: 5,      // 5%
                minVolumeH1: 5000,        // $5K
                minVolumeToLiquidityRatio: 0.1, // Volume should be at least 10% of liquidity
                maxAge: 72 * 60 * 60 * 1000 // 72 hours
            },
            mediumPotential: { // Second pass - relaxed criteria for medium potential tokens
                minLiquidityUsd: 5000,    // $5K
                maxLiquidityUsd: 1000000, // $1M
                minPriceChangeH1: 3,      // 3%
                minVolumeH1: 2000,        // $2K
                minVolumeToLiquidityRatio: 0.05, // Volume should be at least 5% of liquidity
                maxAge: 72 * 60 * 60 * 1000 // 72 hours
            },
            standard: { // Third pass - standard criteria for remaining tokens
                minLiquidityUsd: 3000,    // $3K
                minPriceChangeH1: 2,      // 2%
                minVolumeH1: 1000,        // $1K
                maxAge: 72 * 60 * 60 * 1000 // 72 hours
            }
        };
        
        // Age-specific criteria adjustments
        this.ageCriteria = {
            veryRecent: { // < 6 hours
                volumeMultiplier: 0.5,    // Lower volume requirements for very new tokens
                priceChangeMultiplier: 0.8, // Lower price change requirements
                minPriceChangeM5: 1,      // 1% in 5 minutes is significant for very new tokens
                minVolumeM5: 500          // $500 in 5 minutes is good for very new tokens
            },
            recent: { // 6-24 hours
                volumeMultiplier: 0.8,    // Slightly lower volume requirements
                priceChangeMultiplier: 1.0 // Standard price change requirements
            },
            established: { // 24-72 hours
                volumeMultiplier: 1.2,    // Higher volume requirements for older tokens
                priceChangeMultiplier: 1.2 // Higher price change requirements
            }
        };
        
        // Initialize Moralis
        this.moralisInitialized = false;
        
        // DEX coverage - expanded from top 5 to top 10
        this.dexCoverageCount = 10;
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

    // Calculate Volume-to-Liquidity Ratio (VLR)
    calculateVLR(volume, liquidity) {
        if (!volume || !liquidity || liquidity === 0) return 0;
        return volume / liquidity;
    }

    // Detect consolidation breakout patterns
    detectConsolidationBreakout(priceHistory) {
        if (!priceHistory || priceHistory.length < 12) return false;
        
        // Look for a period of low volatility followed by a significant price move
        const recentPrices = priceHistory.slice(-12); // Last 12 time periods
        const consolidationPrices = recentPrices.slice(0, 8); // First 8 of those periods
        const breakoutPrices = recentPrices.slice(-4); // Last 4 periods
        
        // Calculate volatility during consolidation period
        const consolidationAvg = consolidationPrices.reduce((sum, price) => sum + price, 0) / consolidationPrices.length;
        const consolidationVolatility = Math.max(...consolidationPrices.map(price => Math.abs(price - consolidationAvg) / consolidationAvg));
        
        // Calculate price change during breakout period
        const breakoutStart = breakoutPrices[0];
        const breakoutEnd = breakoutPrices[breakoutPrices.length - 1];
        const breakoutChange = (breakoutEnd - breakoutStart) / breakoutStart;
        
        // Detect breakout pattern: low volatility followed by significant price change
        return consolidationVolatility < 0.03 && Math.abs(breakoutChange) > 0.05;
    }

    // Detect higher lows pattern (bullish indicator)
    detectHigherLows(priceHistory) {
        if (!priceHistory || priceHistory.length < 6) return false;
        
        // Get local minimums from the price history
        const localMins = [];
        for (let i = 1; i < priceHistory.length - 1; i++) {
            if (priceHistory[i] < priceHistory[i-1] && priceHistory[i] < priceHistory[i+1]) {
                localMins.push({ index: i, price: priceHistory[i] });
            }
        }
        
        // Need at least 3 local minimums to detect a pattern
        if (localMins.length < 3) return false;
        
        // Check if the last 3 local minimums are increasing
        const last3Mins = localMins.slice(-3);
        return last3Mins[0].price < last3Mins[1].price && last3Mins[1].price < last3Mins[2].price;
    }

    // Calculate token score based on multiple factors (0-10 scale)
    calculateTokenScore(token) {
        if (!token) return 0;
        
        let score = 0;
        const maxScore = 10;
        
        // Base metrics
        const liquidity = token.liquidity?.usd || 0;
        const volume = token.volume?.h24 || 0;
        const priceChange = token.priceChange?.h24 || 0;
        const pairAge = token.pairCreatedAt ? (Date.now() - new Date(token.pairCreatedAt).getTime()) : 0;
        const ageInHours = pairAge / (60 * 60 * 1000);
        
        // Calculate VLR
        const vlr = this.calculateVLR(volume, liquidity);
        
        // Liquidity score (0-2 points)
        // Sweet spot is $10K-$500K
        if (liquidity >= 10000 && liquidity <= 500000) {
            score += 2;
        } else if (liquidity > 500000 || (liquidity >= 5000 && liquidity < 10000)) {
            score += 1;
        }
        
        // Volume score (0-2 points)
        if (volume > 10000) {
            score += 2;
        } else if (volume > 5000) {
            score += 1.5;
        } else if (volume > 1000) {
            score += 1;
        } else if (volume > 500) {
            score += 0.5;
        }
        
        // VLR score (0-2 points)
        if (vlr > 0.5) {
            score += 2;
        } else if (vlr > 0.2) {
            score += 1.5;
        } else if (vlr > 0.1) {
            score += 1;
        } else if (vlr > 0.05) {
            score += 0.5;
        }
        
        // Price change score (0-2 points)
        const absPriceChange = Math.abs(priceChange);
        if (absPriceChange > 20 && priceChange > 0) {
            score += 2;
        } else if (absPriceChange > 10 && priceChange > 0) {
            score += 1.5;
        } else if (absPriceChange > 5 && priceChange > 0) {
            score += 1;
        } else if (absPriceChange > 20 && priceChange < 0) {
            // Negative price changes are less favorable but still interesting
            score += 0.5;
        }
        
        // Age score (0-1 points)
        // Newer tokens (but not too new) are preferred
        if (ageInHours >= 6 && ageInHours <= 48) {
            score += 1;
        } else if (ageInHours < 6 || ageInHours <= 72) {
            score += 0.5;
        }
        
        // Pattern recognition (0-1 points)
        if (token.priceHistory) {
            if (this.detectConsolidationBreakout(token.priceHistory)) {
                score += 0.5;
            }
            if (this.detectHigherLows(token.priceHistory)) {
                score += 0.5;
            }
        }
        
        // Normalize score to 0-10 scale
        return Math.min(Math.round(score * 10) / 10, maxScore);
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
                
                // Calculate VLR if possible
                const mainPool = dexscreenerPools[0];
                if (mainPool.liquidity?.usd && mainPool.volume?.h24) {
                    analysis.vlr = this.calculateVLR(mainPool.volume.h24, mainPool.liquidity.usd);
                }
                
                // Calculate score
                analysis.score = this.calculateTokenScore(mainPool);
            }
            
            logger.high(`Completed comprehensive analysis for ${tokenAddress}`);
            return analysis;
        } catch (error) {
            logger.error(`Comprehensive token analysis failed: ${error.message}`);
            return null;
        }
    }

    // Apply age-specific criteria adjustments
    applyAgeCriteria(pair, criteriaType) {
        const now = Date.now();
        const pairAge = now - new Date(pair.pairCreatedAt).getTime();
        const baseCriteria = this.criteria[criteriaType];
        
        let ageCategory;
        if (pairAge <= 6 * 60 * 60 * 1000) { // < 6 hours
            ageCategory = 'veryRecent';
        } else if (pairAge <= 24 * 60 * 60 * 1000) { // 6-24 hours
            ageCategory = 'recent';
        } else { // 24-72 hours
            ageCategory = 'established';
        }
        
        const ageAdjustments = this.ageCriteria[ageCategory];
        
        // Apply age-specific adjustments to criteria
        const adjustedCriteria = { ...baseCriteria };
        
        if (adjustedCriteria.minVolumeH1) {
            adjustedCriteria.minVolumeH1 *= ageAdjustments.volumeMultiplier;
        }
        
        if (adjustedCriteria.minPriceChangeH1) {
            adjustedCriteria.minPriceChangeH1 *= ageAdjustments.priceChangeMultiplier;
        }
        
        // For very recent tokens, also check 5-minute metrics
        if (ageCategory === 'veryRecent') {
            adjustedCriteria.minPriceChangeM5 = ageAdjustments.minPriceChangeM5;
            adjustedCriteria.minVolumeM5 = ageAdjustments.minVolumeM5;
        }
        
        return { adjustedCriteria, ageCategory };
    }

    // Check if a pair meets the criteria
    pairMeetsCriteria(pair, criteriaType) {
        if (!pair || !pair.pairCreatedAt) return false;
        
        const { adjustedCriteria, ageCategory } = this.applyAgeCriteria(pair, criteriaType);
        
        // Calculate VLR
        const liquidity = pair.liquidity?.usd || 0;
        const volumeH1 = pair.volume?.h1 || 0;
        const vlr = this.calculateVLR(volumeH1, liquidity);
        
        // Basic liquidity check
        if (liquidity < adjustedCriteria.minLiquidityUsd) return false;
        
        // Check liquidity upper bound if specified
        if (adjustedCriteria.maxLiquidityUsd && liquidity > adjustedCriteria.maxLiquidityUsd) return false;
        
        // Check VLR if specified
        if (adjustedCriteria.minVolumeToLiquidityRatio && vlr < adjustedCriteria.minVolumeToLiquidityRatio) return false;
        
        // For very recent tokens, check 5-minute metrics
        if (ageCategory === 'veryRecent' && adjustedCriteria.minPriceChangeM5) {
            const priceChangeM5 = Math.abs(pair.priceChange?.m5 || 0);
            const volumeM5 = pair.volume?.m5 || 0;
            
            if (priceChangeM5 >= adjustedCriteria.minPriceChangeM5 && volumeM5 >= adjustedCriteria.minVolumeM5) {
                return true;
            }
        }
        
        // Check hourly metrics
        const priceChangeH1 = Math.abs(pair.priceChange?.h1 || 0);
        
        return priceChangeH1 >= adjustedCriteria.minPriceChangeH1 && volumeH1 >= adjustedCriteria.minVolumeH1;
    }

    // Discover new tokens using multi-pass approach
    async discoverNewTokens() {
        try {
            logger.high('Starting multi-pass token discovery process');
            
            // Get popular DEXes
            const popularDexes = await dexscreener.getPopularDexes();
            logger.deep(`Found ${popularDexes.length} popular DEXes`);
            
            const allPairs = [];
            const now = Date.now();
            
            // Fetch pairs from each DEX - expanded from top 5 to top 10
            for (const dexId of popularDexes.slice(0, this.dexCoverageCount)) {
                try {
                    const pairs = await dexscreener.getPairsFromDex(dexId);
                    
                    // Filter pairs by age - expanded from 24 to 72 hours
                    const recentPairs = pairs.filter(pair => {
                        if (!pair.pairCreatedAt) return false;
                        const pairAge = now - new Date(pair.pairCreatedAt).getTime();
                        return pairAge <= this.criteria.highPotential.maxAge; // 72 hours
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
            
            // Filter out previously discovered tokens
            const newUniquePairs = uniquePairs.filter(pair => 
                !this.discoveredTokensHistory.has(pair.baseToken?.address)
            );
            
            logger.deep(`Found ${newUniquePairs.length} new unique token pairs not previously discovered`);
            
            // Multi-pass discovery approach
            const discoveredTokens = [];
            
            // First pass: High potential tokens (strict criteria)
            logger.high('First pass: Identifying high potential tokens with strict criteria');
            for (const pair of newUniquePairs) {
                try {
                    if (this.pairMeetsCriteria(pair, 'highPotential')) {
                        // Enhance with Moralis data
                        const enhancedToken = await this.enhanceTokenData(pair);
                        
                        // Calculate and add score
                        const score = this.calculateTokenScore(pair);
                        enhancedToken.score = score;
                        enhancedToken.potentialCategory = 'high';
                        
                        discoveredTokens.push(enhancedToken);
                        this.discoveredTokensHistory.add(pair.baseToken?.address);
                        
                        // Format token data for logging
                        const tokenData = {
                            symbol: pair.baseToken?.symbol || 'Unknown',
                            name: pair.baseToken?.name || 'Unknown',
                            address: pair.baseToken?.address,
                            price: pair.priceUsd,
                            priceChange: pair.priceChange?.h24,
                            volume: pair.volume?.h24,
                            liquidity: pair.liquidity?.usd,
                            age: `${Math.round((now - new Date(pair.pairCreatedAt).getTime()) / (60 * 60 * 1000))} hours`,
                            exchange: pair.dexId,
                            score: score,
                            potentialCategory: 'high'
                        };
                        
                        logger.token(JSON.stringify(tokenData));
                    }
                } catch (error) {
                    logger.error(`Error processing pair ${pair.baseToken?.address} in first pass: ${error.message}`);
                }
            }
            
            logger.deep(`First pass complete. Found ${discoveredTokens.length} high potential tokens`);
            
            // Second pass: Medium potential tokens (relaxed criteria)
            if (discoveredTokens.length < 10) {
                logger.high('Second pass: Identifying medium potential tokens with relaxed criteria');
                for (const pair of newUniquePairs) {
                    // Skip tokens we've already discovered
                    if (discoveredTokens.some(token => token.baseToken?.address === pair.baseToken?.address)) {
                        continue;
                    }
                    
                    try {
                        if (this.pairMeetsCriteria(pair, 'mediumPotential')) {
                            // Enhance with Moralis data
                            const enhancedToken = await this.enhanceTokenData(pair);
                            
                            // Calculate and add score
                            const score = this.calculateTokenScore(pair);
                            enhancedToken.score = score;
                            enhancedToken.potentialCategory = 'medium';
                            
                            discoveredTokens.push(enhancedToken);
                            this.discoveredTokensHistory.add(pair.baseToken?.address);
                            
                            // Format token data for logging
                            const tokenData = {
                                symbol: pair.baseToken?.symbol || 'Unknown',
                                name: pair.baseToken?.name || 'Unknown',
                                address: pair.baseToken?.address,
                                price: pair.priceUsd,
                                priceChange: pair.priceChange?.h24,
                                volume: pair.volume?.h24,
                                liquidity: pair.liquidity?.usd,
                                age: `${Math.round((now - new Date(pair.pairCreatedAt).getTime()) / (60 * 60 * 1000))} hours`,
                                exchange: pair.dexId,
                                score: score,
                                potentialCategory: 'medium'
                            };
                            
                            logger.token(JSON.stringify(tokenData));
                            
                            // Stop if we've found enough tokens
                            if (discoveredTokens.length >= 15) {
                                break;
                            }
                        }
                    } catch (error) {
                        logger.error(`Error processing pair ${pair.baseToken?.address} in second pass: ${error.message}`);
                    }
                }
            }
            
            logger.deep(`Second pass complete. Found ${discoveredTokens.length} tokens so far`);
            
            // Third pass: Standard criteria for remaining tokens
            if (discoveredTokens.length < 15) {
                logger.high('Third pass: Applying standard criteria to remaining tokens');
                for (const pair of newUniquePairs) {
                    // Skip tokens we've already discovered
                    if (discoveredTokens.some(token => token.baseToken?.address === pair.baseToken?.address)) {
                        continue;
                    }
                    
                    try {
                        if (this.pairMeetsCriteria(pair, 'standard')) {
                            // Enhance with Moralis data
                            const enhancedToken = await this.enhanceTokenData(pair);
                            
                            // Calculate and add score
                            const score = this.calculateTokenScore(pair);
                            enhancedToken.score = score;
                            enhancedToken.potentialCategory = 'standard';
                            
                            discoveredTokens.push(enhancedToken);
                            this.discoveredTokensHistory.add(pair.baseToken?.address);
                            
                            // Format token data for logging
                            const tokenData = {
                                symbol: pair.baseToken?.symbol || 'Unknown',
                                name: pair.baseToken?.name || 'Unknown',
                                address: pair.baseToken?.address,
                                price: pair.priceUsd,
                                priceChange: pair.priceChange?.h24,
                                volume: pair.volume?.h24,
                                liquidity: pair.liquidity?.usd,
                                age: `${Math.round((now - new Date(pair.pairCreatedAt).getTime()) / (60 * 60 * 1000))} hours`,
                                exchange: pair.dexId,
                                score: score,
                                potentialCategory: 'standard'
                            };
                            
                            logger.token(JSON.stringify(tokenData));
                            
                            // Stop if we've found enough tokens
                            if (discoveredTokens.length >= 20) {
                                break;
                            }
                        }
                    } catch (error) {
                        logger.error(`Error processing pair ${pair.baseToken?.address} in third pass: ${error.message}`);
                    }
                }
            }
            
            // Sort tokens by score (highest first)
            discoveredTokens.sort((a, b) => (b.score || 0) - (a.score || 0));
            
            logger.high(`Multi-pass token discovery complete. Found ${discoveredTokens.length} tokens`);
            return discoveredTokens;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            return [];
        }
    }
}

const fetchAnalyze = new FetchAnalyzeModule();
module.exports = fetchAnalyze;
