const bitqueryApi = require('./bitqueryApi');
const jupiterApi = require('./jupiterApi');
const birdeyeApi = require('./birdeyeApi');
const logger = require('./logger');
const config = require('./config');

class TokenDiscovery {
    constructor() {
        this.discoveryCache = new Map();
        this.lastScanTime = 0;
        this.scanInterval = config.TRADE_INTERVAL_MS || 30000;
        this.maxCacheAge = 60000;
        this.activeAnalyses = new Set();
    }

    async start() {
        logger.high('Starting token discovery system');
        
        // Start Bitquery token discovery subscription
        this.discoverySubscription = await bitqueryApi.startTokenDiscovery(
            async (token) => this.processNewToken(token)
        );

        return () => this.cleanup();
    }

    async processNewToken(token) {
        try {
            if (this.discoveryCache.has(token.MintAddress)) {
                return;
            }

            logger.deep(`Processing new token: ${token.Symbol} (${token.MintAddress})`);

            // Check liquidity on DEXes
            const liquidityInfo = await bitqueryApi.checkLiquidityPool(token.MintAddress);
            if (!liquidityInfo.hasLiquidity) {
                logger.deep(`${token.Symbol} rejected: Insufficient liquidity ($${liquidityInfo.liquidity})`);
                return;
            }

            // Start trade analysis
            const analysis = await this.analyzeToken(token, liquidityInfo);
            
            if (analysis.isViable) {
                this.discoveryCache.set(token.MintAddress, analysis);
                this.activeAnalyses.add(token.MintAddress);
                
                // Monitor trades for profit taking
                this.monitorTokenTrades(token.MintAddress, analysis.entryPrice);
            }

        } catch (error) {
            logger.error(`Error processing token ${token.Symbol}: ${error.message}`);
        }
    }

    async analyzeToken(token, liquidityInfo) {
        const analysis = {
            address: token.MintAddress,
            symbol: token.Symbol,
            name: token.Name,
            liquidity: liquidityInfo.liquidity,
            exchanges: liquidityInfo.exchanges,
            isViable: false,
            metrics: {},
            reasons: []
        };

        try {
            // Get additional data from Birdeye for cross-validation
            const birdeyeData = await birdeyeApi.getTokenInfo(token.MintAddress);
            
            // Start trade analysis with Bitquery
            const tradeMetrics = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 30000); // 30s timeout
                
                bitqueryApi.startTradeAnalysis(token.MintAddress, (metrics) => {
                    clearTimeout(timeout);
                    resolve(metrics);
                });
            });

            if (!tradeMetrics) {
                logger.deep(`${token.Symbol} rejected: No trade activity detected`);
                return analysis;
            }

            // Get holder distribution
            const holders = await bitqueryApi.getHolderDistribution(token.MintAddress);
            
            // Combine all metrics
            analysis.metrics = {
                priceUSD: tradeMetrics.currentPrice,
                buySellRatio: tradeMetrics.buySellRatio,
                uniqueBuyers: tradeMetrics.uniqueBuyerCount,
                uniqueSellers: tradeMetrics.uniqueSellerCount,
                totalVolume: tradeMetrics.totalVolume,
                topHolderCount: holders.length,
                topHolderBalance: holders[0]?.balance || 0,
                birdeyePrice: birdeyeData?.price || 0,
                priceConsistency: this.calculatePriceConsistency(
                    tradeMetrics.currentPrice,
                    birdeyeData?.price
                )
            };

            // Score the token
            analysis.combinedScore = this.calculateCombinedScore(analysis);
            analysis.isViable = this.isViableForTrading(analysis);
            analysis.entryPrice = tradeMetrics.currentPrice;

            if (analysis.isViable) {
                logger.high(`Viable token found: ${token.Symbol}`, {
                    metrics: analysis.metrics,
                    score: analysis.combinedScore
                });
            } else {
                logger.deep(`${token.Symbol} rejected: Failed viability check`);
            }

            return analysis;

        } catch (error) {
            logger.error(`Analysis failed for ${token.Symbol}: ${error.message}`);
            return analysis;
        }
    }

    calculatePriceConsistency(bitqueryPrice, birdeyePrice) {
        if (!bitqueryPrice || !birdeyePrice) return 0;
        const deviation = Math.abs(bitqueryPrice - birdeyePrice) / Math.max(bitqueryPrice, birdeyePrice);
        return Math.max(0, 1 - (deviation * 2));
    }

    calculateCombinedScore(analysis) {
        let score = 0;
        const m = analysis.metrics;

        // Liquidity score (0-30 points)
        if (analysis.liquidity >= 10000) {
            score += Math.min(30, (analysis.liquidity / 10000) * 10);
        }

        // Buy/Sell ratio score (0-20 points)
        if (m.buySellRatio >= 1) {
            score += Math.min(20, m.buySellRatio * 5);
        }

        // Unique traders score (0-20 points)
        const uniqueTraders = m.uniqueBuyers + m.uniqueSellers;
        score += Math.min(20, uniqueTraders / 5);

        // Volume score (0-15 points)
        if (m.totalVolume >= 5000) {
            score += Math.min(15, (m.totalVolume / 5000) * 5);
        }

        // Price consistency score (0-15 points)
        score += m.priceConsistency * 15;

        return Math.round(score);
    }

    isViableForTrading(analysis) {
        const m = analysis.metrics;
        const viable = 
            analysis.liquidity >= 10000 &&
            analysis.combinedScore >= 35 &&
            m.priceConsistency >= 0.85 &&
            m.buySellRatio >= 1.2 &&
            m.uniqueBuyers >= 20;

        if (!viable) {
            logger.deep(`${analysis.symbol} viability check failed:`, {
                liquidity: `${analysis.liquidity >= 10000 ? 'Pass' : 'Fail'} ($${analysis.liquidity})`,
                score: `${analysis.combinedScore >= 35 ? 'Pass' : 'Fail'} (${analysis.combinedScore})`,
                consistency: `${m.priceConsistency >= 0.85 ? 'Pass' : 'Fail'} (${(m.priceConsistency * 100).toFixed(1)}%)`,
                buySellRatio: `${m.buySellRatio >= 1.2 ? 'Pass' : 'Fail'} (${m.buySellRatio.toFixed(2)})`,
                uniqueBuyers: `${m.uniqueBuyers >= 20 ? 'Pass' : 'Fail'} (${m.uniqueBuyers})`
            });
        }

        return viable;
    }

    monitorTokenTrades(tokenAddress, entryPrice) {
        bitqueryApi.startTradeAnalysis(tokenAddress, (metrics) => {
            try {
                // Check for profit target or stop loss
                const priceChange = (metrics.currentPrice - entryPrice) / entryPrice;
                
                if (priceChange >= 0.10) { // 10% profit target
                    logger.high(`Profit target reached for ${tokenAddress}`, {
                        entryPrice,
                        currentPrice: metrics.currentPrice,
                        profit: `${(priceChange * 100).toFixed(1)}%`
                    });
                    this.stopMonitoring(tokenAddress);
                }
                else if (priceChange <= -0.05) { // 5% stop loss
                    logger.high(`Stop loss triggered for ${tokenAddress}`, {
                        entryPrice,
                        currentPrice: metrics.currentPrice,
                        loss: `${(priceChange * 100).toFixed(1)}%`
                    });
                    this.stopMonitoring(tokenAddress);
                }
            } catch (error) {
                logger.error(`Error monitoring ${tokenAddress}: ${error.message}`);
            }
        });
    }

    stopMonitoring(tokenAddress) {
        bitqueryApi.stopTradeAnalysis(tokenAddress);
        this.activeAnalyses.delete(tokenAddress);
        logger.deep(`Stopped monitoring ${tokenAddress}`);
    }

    cleanup() {
        if (this.discoverySubscription) {
            this.discoverySubscription.unsubscribe();
        }
        
        for (const tokenAddress of this.activeAnalyses) {
            this.stopMonitoring(tokenAddress);
        }
        
        this.discoveryCache.clear();
        bitqueryApi.cleanup();
        logger.high('Token discovery system cleaned up');
    }
}

module.exports = new TokenDiscovery();