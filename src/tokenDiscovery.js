const dexScreener = require('./dexScreener');
const birdeyeApi = require('./birdeyeApi');
const config = require('./config');
const logger = require('./logger');

class TokenDiscovery {
    constructor() {
        this.minLiquidity = config.MIN_LIQUIDITY_USD || 10000; // Default $10k min liquidity
        this.discoveryCache = new Map();
        this.lastScanTime = 0;
        this.scanInterval = config.TRADE_INTERVAL_MS || 30000; // Reduced to 30 seconds for testing
        this.maxCacheAge = 60000; // Cache valid for 1 minute
    }

    async findTradingOpportunities(forceFresh = false) {
        try {
            logger.high('Starting token discovery scan');
            
            const now = Date.now();
            const cacheAge = now - this.lastScanTime;

            // Check if we should use cache
            if (!forceFresh && cacheAge < this.maxCacheAge && this.discoveryCache.size > 0) {
                logger.deep(`Using cached discovery results (age: ${Math.round(cacheAge / 1000)}s)`);
                return Array.from(this.discoveryCache.values());
            }

            // Clear cache before new scan
            this.discoveryCache.clear();
            logger.deep('Cache cleared, performing fresh token scan');

            // Get initial token list from DEX Screener
            const pairs = await dexScreener.searchMemecoins();
            logger.high(`Found ${pairs.length} initial token candidates`);

            const opportunities = [];
            for (const pair of pairs) {
                const token = pair.baseToken;
                if (!token || !token.address) continue;

                // Skip if token was recently analyzed and failed
                if (this.discoveryCache.has(token.address)) {
                    continue;
                }

                // Get detailed analysis from both sources
                const [dexAnalysis, birdeyeAnalysis] = await Promise.all([
                    dexScreener.analyzeToken(pair),
                    birdeyeApi.analyzeToken(token.address)
                ]);

                if (!dexAnalysis || !birdeyeAnalysis) continue;

                // Combine and score the analyses
                const combinedAnalysis = this.combineAnalyses(token, dexAnalysis, birdeyeAnalysis);
                
                // Store in cache regardless of viability
                this.discoveryCache.set(token.address, combinedAnalysis);
                
                if (combinedAnalysis.isViable) {
                    opportunities.push(combinedAnalysis);
                }
            }

            // Sort by combined score
            opportunities.sort((a, b) => b.combinedScore - a.combinedScore);
            this.lastScanTime = now;

            logger.high(`Found ${opportunities.length} viable trading opportunities`);
            return opportunities;
        } catch (error) {
            logger.error(`Token discovery failed: ${error.message}`);
            return [];
        }
    }

    combineAnalyses(token, dexAnalysis, birdeyeAnalysis) {
        const analysis = {
            address: token.address,
            symbol: token.symbol,
            price: birdeyeAnalysis.price,
            liquidity: Math.min(dexAnalysis.liquidity, birdeyeAnalysis.liquidity || 0),
            volume24h: dexAnalysis.volume24h,
            priceChange1h: birdeyeAnalysis.priceChange1h,
            priceChange24h: dexAnalysis.priceChange24h,
            dexScore: dexAnalysis.score,
            reasons: [...dexAnalysis.reasons],
            metrics: {
                ...dexAnalysis.metrics,
                priceConsistency: this.calculatePriceConsistency(dexAnalysis.price, birdeyeAnalysis.price)
            },
            lastUpdate: birdeyeAnalysis.updateTime
        };

        // Calculate combined score (0-100)
        analysis.combinedScore = this.calculateCombinedScore(analysis);
        
        // Determine if token is viable for trading
        analysis.isViable = this.isViableForTrading(analysis);

        logger.token(JSON.stringify(analysis, null, 2));
        return analysis;
    }

    calculatePriceConsistency(dexPrice, birdeyePrice) {
        if (!dexPrice || !birdeyePrice) return 0;
        // Allow for larger price differences between sources
        const deviation = Math.abs(dexPrice - birdeyePrice) / Math.max(dexPrice, birdeyePrice);
        return Math.max(0, 1 - (deviation * 2)); // More forgiving calculation
    }

    calculateCombinedScore(analysis) {
        let score = 0;

        // Base score from DEX Screener (0-40 points, reduced from 50)
        score += (analysis.dexScore / 11) * 40;

        // Increased liquidity score (0-25 points, up from 15)
        if (analysis.liquidity >= this.minLiquidity) {
            score += Math.min(25, (analysis.liquidity / this.minLiquidity) * 8);
        }

        // Price momentum score (0-20 points, up from 15)
        if (analysis.priceChange1h > 0) {
            score += Math.min(20, analysis.priceChange1h);
        }

        // Reduced weight of price consistency (0-5 points, down from 10)
        score += analysis.metrics.priceConsistency * 5;

        // Volume to liquidity ratio score (0-10 points, unchanged)
        const vlRatio = analysis.volume24h / analysis.liquidity;
        if (vlRatio >= 0.5 && vlRatio <= 5) {
            score += Math.min(10, vlRatio * 2);
        }

        return Math.round(score);
    }

    isViableForTrading(analysis) {
        const viable = analysis.liquidity >= this.minLiquidity &&
               analysis.combinedScore >= 35 && // Further lowered from 40
               analysis.metrics.priceConsistency >= 0.85 && // Further lowered from 0.90
               !this.hasExcessiveVolatility(analysis);

        if (!viable) {
            logger.deep(`Token ${analysis.symbol} rejected: ` +
                `Liquidity: ${analysis.liquidity >= this.minLiquidity ? 'Pass' : 'Fail'}, ` +
                `Score: ${analysis.combinedScore >= 35 ? 'Pass' : 'Fail'}, ` +
                `Consistency: ${analysis.metrics.priceConsistency >= 0.85 ? 'Pass' : 'Fail'}, ` +
                `Volatility: ${!this.hasExcessiveVolatility(analysis) ? 'Pass' : 'Fail'}`
            );
        } else {
            logger.deep(`Token ${analysis.symbol} ACCEPTED with metrics: ` +
                `Liquidity: $${analysis.liquidity.toLocaleString()}, ` +
                `Score: ${analysis.combinedScore}, ` +
                `Consistency: ${(analysis.metrics.priceConsistency * 100).toFixed(1)}%, ` +
                `24h Change: ${analysis.priceChange24h?.toFixed(1)}%`
            );
        }

        return viable;
    }

    hasExcessiveVolatility(analysis) {
        // More lenient thresholds for volatility
        const excessive = Math.abs(analysis.priceChange24h) > 2000 || // Increased from 1000
                         Math.abs(analysis.priceChange1h) > 200;      // Increased from 100

        if (excessive) {
            logger.deep(`Excessive volatility for ${analysis.symbol}: ` +
                `24h change: ${analysis.priceChange24h}%, ` +
                `1h change: ${analysis.priceChange1h}%`
            );
        }

        return excessive;
    }
}

module.exports = new TokenDiscovery();