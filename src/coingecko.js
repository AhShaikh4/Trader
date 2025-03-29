const axios = require('axios');
const logger = require('./logger');

class CoinGeckoAPI {
    constructor() {
        this.baseUrl = 'https://api.coingecko.com/api/v3';
        this.rateLimit = 30; // 30 calls per minute for free tier
        this.requestTimestamps = [];
        this.cache = new Map();
        this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes cache
    }

    // Rate limiting implementation
    async throttleRequest() {
        const now = Date.now();
        // Remove timestamps older than 1 minute
        this.requestTimestamps = this.requestTimestamps.filter(
            timestamp => now - timestamp < 60000
        );
        
        // Check if we're at the rate limit
        if (this.requestTimestamps.length >= this.rateLimit) {
            // Calculate time to wait until oldest request expires
            const waitTime = 60000 - (now - this.requestTimestamps[0]) + 100; // Add 100ms buffer
            logger.deep(`CoinGecko rate limit reached, waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.throttleRequest(); // Recheck after waiting
        }
        
        // Add current timestamp to the list
        this.requestTimestamps.push(now);
    }

    // Cache implementation
    getCachedData(key) {
        const cachedItem = this.cache.get(key);
        if (!cachedItem) return null;
        
        const now = Date.now();
        if (now - cachedItem.timestamp > this.cacheExpiryTime) {
            this.cache.delete(key);
            return null;
        }
        
        return cachedItem.data;
    }

    setCacheData(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    // Helper method to make API requests with rate limiting and caching
    async makeRequest(endpoint, params = {}) {
        const queryString = Object.keys(params)
            .map(key => `${key}=${encodeURIComponent(params[key])}`)
            .join('&');
        
        const url = `${this.baseUrl}${endpoint}${queryString ? `?${queryString}` : ''}`;
        const cacheKey = url;
        
        // Check cache first
        const cachedData = this.getCachedData(cacheKey);
        if (cachedData) {
            logger.deep(`Using cached data for ${endpoint}`);
            return cachedData;
        }
        
        // Apply rate limiting
        await this.throttleRequest();
        
        try {
            logger.deep(`Making CoinGecko API request to ${endpoint}`);
            const response = await axios.get(url);
            
            // Cache the response
            this.setCacheData(cacheKey, response.data);
            
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                logger.error(`CoinGecko rate limit exceeded: ${error.message}`);
                // Wait and retry
                await new Promise(resolve => setTimeout(resolve, 60000));
                return this.makeRequest(endpoint, params);
            }
            
            logger.error(`CoinGecko API error: ${error.message}`);
            throw error;
        }
    }

    // Get trending coins
    async getTrendingCoins() {
        try {
            logger.high('Fetching trending coins from CoinGecko');
            const data = await this.makeRequest('/search/trending');
            
            if (!data || !data.coins) {
                logger.error('Invalid response format from CoinGecko trending endpoint');
                return [];
            }
            
            const trendingCoins = data.coins.map(item => ({
                id: item.item.id,
                name: item.item.name,
                symbol: item.item.symbol,
                marketCapRank: item.item.market_cap_rank,
                thumb: item.item.thumb,
                score: item.item.score
            }));
            
            logger.high(`Found ${trendingCoins.length} trending coins on CoinGecko`);
            return trendingCoins;
        } catch (error) {
            logger.error(`Failed to fetch trending coins: ${error.message}`);
            return [];
        }
    }

    // Get coin details by ID
    async getCoinDetails(coinId) {
        try {
            logger.deep(`Fetching details for coin ${coinId}`);
            const data = await this.makeRequest(`/coins/${coinId}`, {
                localization: false,
                tickers: false,
                market_data: true,
                community_data: false,
                developer_data: false,
                sparkline: false
            });
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch details for coin ${coinId}: ${error.message}`);
            return null;
        }
    }

    // Get historical market data for a coin
    async getCoinMarketChart(coinId, vsCurrency = 'usd', days = 7) {
        try {
            logger.deep(`Fetching market chart for ${coinId} (${days} days)`);
            const data = await this.makeRequest(`/coins/${coinId}/market_chart`, {
                vs_currency: vsCurrency,
                days: days
            });
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch market chart for ${coinId}: ${error.message}`);
            return null;
        }
    }

    // Get global crypto market data
    async getGlobalData() {
        try {
            logger.deep('Fetching global crypto market data');
            const data = await this.makeRequest('/global');
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch global market data: ${error.message}`);
            return null;
        }
    }

    // Get coins with market data
    async getCoinsMarkets(vsCurrency = 'usd', category = '', order = 'market_cap_desc', perPage = 100, page = 1) {
        try {
            logger.deep(`Fetching coins market data (page ${page})`);
            const params = {
                vs_currency: vsCurrency,
                order: order,
                per_page: perPage,
                page: page,
                sparkline: false
            };
            
            if (category) {
                params.category = category;
            }
            
            const data = await this.makeRequest('/coins/markets', params);
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch coins market data: ${error.message}`);
            return [];
        }
    }

    // Get all coin categories
    async getCoinCategories() {
        try {
            logger.deep('Fetching coin categories');
            const data = await this.makeRequest('/coins/categories');
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch coin categories: ${error.message}`);
            return [];
        }
    }

    // Get OHLC data for a coin
    async getCoinOHLC(coinId, vsCurrency = 'usd', days = 7) {
        try {
            logger.deep(`Fetching OHLC data for ${coinId} (${days} days)`);
            const data = await this.makeRequest(`/coins/${coinId}/ohlc`, {
                vs_currency: vsCurrency,
                days: days
            });
            
            return data;
        } catch (error) {
            logger.error(`Failed to fetch OHLC data for ${coinId}: ${error.message}`);
            return [];
        }
    }

    // Analyze price patterns using historical data
    async analyzePricePatterns(coinId, vsCurrency = 'usd', days = 30) {
        try {
            logger.high(`Analyzing price patterns for ${coinId}`);
            const marketData = await this.getCoinMarketChart(coinId, vsCurrency, days);
            
            if (!marketData || !marketData.prices || marketData.prices.length < 10) {
                logger.error(`Insufficient data for price pattern analysis of ${coinId}`);
                return null;
            }
            
            const prices = marketData.prices.map(item => item[1]);
            const volumes = marketData.total_volumes.map(item => item[1]);
            
            // Calculate simple moving averages
            const sma7 = this.calculateSMA(prices, 7);
            const sma25 = this.calculateSMA(prices, 25);
            
            // Calculate RSI
            const rsi = this.calculateRSI(prices, 14);
            
            // Calculate MACD
            const macd = this.calculateMACD(prices);
            
            // Calculate volume trends
            const volumeTrend = this.calculateVolumeTrend(volumes, 7);
            
            // Identify price patterns
            const patterns = {
                uptrend: sma7[sma7.length - 1] > sma25[sma25.length - 1],
                strongUptrend: sma7[sma7.length - 1] > sma25[sma25.length - 1] * 1.05,
                downtrend: sma7[sma7.length - 1] < sma25[sma25.length - 1],
                strongDowntrend: sma7[sma7.length - 1] < sma25[sma25.length - 1] * 0.95,
                overbought: rsi > 70,
                oversold: rsi < 30,
                bullishMACDCrossover: macd.signal < macd.line && macd.histogram > 0,
                bearishMACDCrossover: macd.signal > macd.line && macd.histogram < 0,
                increasingVolume: volumeTrend > 1.1,
                decreasingVolume: volumeTrend < 0.9
            };
            
            // Calculate overall score (0-100)
            let score = 50; // Start neutral
            
            // Adjust score based on patterns
            if (patterns.uptrend) score += 5;
            if (patterns.strongUptrend) score += 10;
            if (patterns.downtrend) score -= 5;
            if (patterns.strongDowntrend) score -= 10;
            if (patterns.overbought) score -= 15;
            if (patterns.oversold) score += 15;
            if (patterns.bullishMACDCrossover) score += 10;
            if (patterns.bearishMACDCrossover) score -= 10;
            if (patterns.increasingVolume && patterns.uptrend) score += 10;
            if (patterns.increasingVolume && patterns.downtrend) score -= 5;
            if (patterns.decreasingVolume && patterns.uptrend) score -= 5;
            
            // Ensure score is within 0-100 range
            score = Math.max(0, Math.min(100, score));
            
            // Get current price and calculate metrics
            const currentPrice = prices[prices.length - 1];
            const priceChange24h = this.calculatePriceChange(prices, 1);
            const priceChange7d = this.calculatePriceChange(prices, 7);
            const volatility = this.calculateVolatility(prices, 7);
            
            return {
                coinId,
                currentPrice,
                priceChange24h,
                priceChange7d,
                volatility,
                technicalIndicators: {
                    rsi,
                    macd: {
                        line: macd.line,
                        signal: macd.signal,
                        histogram: macd.histogram
                    },
                    sma: {
                        sma7: sma7[sma7.length - 1],
                        sma25: sma25[sma25.length - 1]
                    }
                },
                patterns,
                score,
                recommendation: this.getRecommendation(score)
            };
        } catch (error) {
            logger.error(`Failed to analyze price patterns for ${coinId}: ${error.message}`);
            return null;
        }
    }

    // Get trading recommendation based on score
    getRecommendation(score) {
        if (score >= 80) return 'Strong Buy';
        if (score >= 60) return 'Buy';
        if (score >= 40) return 'Hold';
        if (score >= 20) return 'Sell';
        return 'Strong Sell';
    }

    // Calculate Simple Moving Average
    calculateSMA(data, period) {
        const result = [];
        
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
        
        return result;
    }

    // Calculate Relative Strength Index
    calculateRSI(data, period = 14) {
        if (data.length < period + 1) {
            return 50; // Not enough data, return neutral
        }
        
        let gains = 0;
        let losses = 0;
        
        // Calculate initial average gain and loss
        for (let i = 1; i <= period; i++) {
            const change = data[i] - data[i - 1];
            if (change >= 0) {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        let avgGain = gains / period;
        let avgLoss = losses / period;
        
        // Calculate RSI using Wilder's smoothing method
        for (let i = period + 1; i < data.length; i++) {
            const change = data[i] - data[i - 1];
            let currentGain = 0;
            let currentLoss = 0;
            
            if (change >= 0) {
                currentGain = change;
            } else {
                currentLoss = -change;
            }
            
            avgGain = ((avgGain * (period - 1)) + currentGain) / period;
            avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
        }
        
        if (avgLoss === 0) {
            return 100; // No losses, RSI is 100
        }
        
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return rsi;
    }

    // Calculate MACD
    calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        if (data.length < slowPeriod + signalPeriod) {
            return { line: 0, signal: 0, histogram: 0 }; // Not enough data
        }
        
        const fastEMA = this.calculateEMA(data, fastPeriod);
        const slowEMA = this.calculateEMA(data, slowPeriod);
        
        // Calculate MACD line
        const macdLine = fastEMA[fastEMA.length - 1] - slowEMA[slowEMA.length - 1];
        
        // Calculate MACD history
        const macdHistory = [];
        for (let i = 0; i < fastEMA.length && i < slowEMA.length; i++) {
            macdHistory.push(fastEMA[i] - slowEMA[i]);
        }
        
        // Calculate signal line (EMA of MACD line)
        const signalLine = this.calculateEMA(macdHistory, signalPeriod)[0];
        
        // Calculate histogram
        const histogram = macdLine - signalLine;
        
        return {
            line: macdLine,
            signal: signalLine,
            histogram: histogram
        };
    }

    // Calculate Exponential Moving Average
    calculateEMA(data, period) {
        if (data.length < period) {
            return [data[data.length - 1]]; // Not enough data, return last price
        }
        
        const k = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        const result = [ema];
        
        for (let i = period; i < data.length; i++) {
            ema = (data[i] * k) + (ema * (1 - k));
            result.push(ema);
        }
        
        return result;
    }

    // Calculate volume trend
    calculateVolumeTrend(volumes, period) {
        if (volumes.length < period * 2) {
            return 1; // Not enough data, return neutral
        }
        
        const recentAvgVolume = volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
        const previousAvgVolume = volumes.slice(-period * 2, -period).reduce((a, b) => a + b, 0) / period;
        
        return recentAvgVolume / previousAvgVolume;
    }

    // Calculate price change percentage
    calculatePriceChange(prices, days) {
        if (prices.length <= days) {
            return 0; // Not enough data
        }
        
        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - 1 - days];
        
        return ((currentPrice - pastPrice) / pastPrice) * 100;
    }

    // Calculate price volatility
    calculateVolatility(prices, days) {
        if (prices.length <= days) {
            return 0; // Not enough data
        }
        
        const recentPrices = prices.slice(-days);
        const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
        
        const squaredDiffs = recentPrices.map(price => Math.pow(price - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
        
        return Math.sqrt(variance) / mean * 100; // Return as percentage
    }

    // Find potential profitable coins based on multiple criteria
    async findProfitableCoins(limit = 10) {
        try {
            logger.high('Searching for profitable coins using CoinGecko data');
            
            // Get trending coins
            const trendingCoins = await this.getTrendingCoins();
            logger.deep(`Found ${trendingCoins.length} trending coins`);
            
            // Get market data for top 250 coins
            const marketCoins = await this.getCoinsMarkets('usd', '', 'market_cap_desc', 250, 1);
            logger.deep(`Found ${marketCoins.length} market coins`);
            
            // Combine and deduplicate coins
            const allCoinIds = new Set();
            const combinedCoins = [];
            
            // Add trending coins
            for (const coin of trendingCoins) {
                if (!allCoinIds.has(coin.id)) {
                    allCoinIds.add(coin.id);
                    combinedCoins.push({
                        id: coin.id,
                        symbol: coin.symbol,
                        name: coin.name,
                        isTrending: true,
                        marketCapRank: coin.marketCapRank || 9999
                    });
                }
            }
            
            // Add market coins
            for (const coin of marketCoins) {
                if (!allCoinIds.has(coin.id)) {
                    allCoinIds.add(coin.id);
                    combinedCoins.push({
                        id: coin.id,
                        symbol: coin.symbol,
                        name: coin.name,
                        isTrending: false,
                        marketCapRank: coin.market_cap_rank || 9999,
                        currentPrice: coin.current_price,
                        marketCap: coin.market_cap,
                        priceChange24h: coin.price_change_percentage_24h,
                        priceChange7d: coin.price_change_percentage_7d_in_currency
                    });
                }
            }
            
            logger.deep(`Combined ${combinedCoins.length} unique coins for analysis`);
            
            // Analyze each coin (limit to 20 to stay within rate limits)
            const analysisLimit = Math.min(20, combinedCoins.length);
            const analyzedCoins = [];
            
            for (let i = 0; i < analysisLimit; i++) {
                const coin = combinedCoins[i];
                logger.deep(`Analyzing coin ${i+1}/${analysisLimit}: ${coin.name} (${coin.symbol})`);
                
                try {
                    const analysis = await this.analyzePricePatterns(coin.id);
                    
                    if (analysis) {
                        analyzedCoins.push({
                            ...coin,
                            analysis
                        });
                    }
                } catch (error) {
                    logger.error(`Error analyzing ${coin.name}: ${error.message}`);
                }
            }
            
            // Score and rank coins
            const scoredCoins = analyzedCoins.map(coin => {
                let finalScore = coin.analysis.score;
                
                // Boost score for trending coins
                if (coin.isTrending) {
                    finalScore += 10;
                }
                
                // Adjust score based on market cap rank (favor smaller coins with potential)
                if (coin.marketCapRank > 100) {
                    finalScore += 5;
                }
                
                // Adjust for recent price movements
                if (coin.analysis.priceChange24h > 10) {
                    finalScore += 5;
                } else if (coin.analysis.priceChange24h < -10) {
                    finalScore -= 5;
                }
                
                // Adjust for volatility (higher volatility = higher potential)
                if (coin.analysis.volatility > 10) {
                    finalScore += 5;
                }
                
                return {
                    ...coin,
                    finalScore: Math.max(0, Math.min(100, finalScore))
                };
            });
            
            // Sort by final score (highest first)
            scoredCoins.sort((a, b) => b.finalScore - a.finalScore);
            
            // Return top N coins
            const topCoins = scoredCoins.slice(0, limit);
            
            logger.high(`Found ${topCoins.length} potentially profitable coins`);
            return topCoins;
        } catch (error) {
            logger.error(`Failed to find profitable coins: ${error.message}`);
            return [];
        }
    }
}

const coinGeckoAPI = new CoinGeckoAPI();
module.exports = coinGeckoAPI;
