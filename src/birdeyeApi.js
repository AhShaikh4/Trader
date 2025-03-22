const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

class BirdeyeApi {
    constructor() {
        this.baseUrl = 'https://public-api.birdeye.so/defi';
        this.headers = {
            'X-API-KEY': config.BIRDEYE_API_KEY
        };
        this.lastRequestTime = 0;
        this.minRequestInterval = 1100; // 1.1 seconds between requests
    }

    async delay() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
            const delayTime = this.minRequestInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delayTime));
        }
        this.lastRequestTime = Date.now();
    }

    async makeRequest(endpoint, params = {}) {
        await this.delay();
        try {
            const url = `${this.baseUrl}/${endpoint}?x-chain=solana`;
            const queryString = Object.entries(params)
                .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
                .join('&');
            
            const fullUrl = queryString ? `${url}&${queryString}` : url;
            logger.deep(`Making request to ${fullUrl}`);
            
            const response = await axios.get(fullUrl, { headers: this.headers });

            if (!response.data || response.data.success !== true) {
                logger.error(`API Error Response: ${JSON.stringify(response.data)}`);
                throw new Error('Invalid response from Birdeye API');
            }

            return response.data.data;
        } catch (error) {
            if (error.response) {
                logger.error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                logger.error(`Request Error: ${error.message}`);
            }
            if (error.response?.status === 429) {
                logger.error('Rate limit hit, waiting 2 seconds before retry');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.makeRequest(endpoint, params);
            }
            throw error;
        }
    }

    async getTokenPrice(tokenAddress) {
        try {
            logger.deep(`Fetching price for token ${tokenAddress}`);
            const data = await this.makeRequest('price', {
                address: tokenAddress,
                include_liquidity: true
            });
            
            if (!data || !data.value) {
                throw new Error('Invalid price data received');
            }

            logger.deep(`Successfully retrieved price data: ${JSON.stringify(data)}`);
            return data;
        } catch (error) {
            logger.error(`Failed to get token price: ${error.message}`);
            return null;
        }
    }

    async getHistoricalPrice(tokenAddress, interval = '15m', durationHours = 1) {
        try {
            logger.deep(`Fetching historical price for token ${tokenAddress} with interval ${interval} over last ${durationHours} hours`);
            const now = Math.floor(Date.now() / 1000);
            const time_from = now - (durationHours * 3600);
            const time_to = now;

            const data = await this.makeRequest('history_price', {
                address: tokenAddress,
                address_type: 'token',
                type: interval,
                time_from: time_from,
                time_to: time_to
            });

            logger.deep(`Successfully retrieved historical price for ${tokenAddress}`);
            return data;
        } catch (error) {
            logger.error(`Failed to get historical price: ${error.message}`);
            return null;
        }
    }

    async analyzeToken(tokenAddress) {
        try {
            logger.deep(`Starting comprehensive analysis for token ${tokenAddress}`);
            
            // Get price data with liquidity info
            const priceData = await this.getTokenPrice(tokenAddress);
            if (!priceData) {
                throw new Error('Failed to retrieve price data');
            }
            
            const analysis = {
                address: tokenAddress,
                price: priceData.value,
                updateTime: priceData.updateHumanTime,
                updateUnixTime: priceData.updateUnixTime,
                liquidity: priceData.liquidity,
                metrics: {
                    price: priceData.value,
                    lastUpdate: new Date(priceData.updateUnixTime * 1000).toISOString()
                }
            };

            // Add historical data if available
            const historicalData = await this.getHistoricalPrice(tokenAddress);
            if (historicalData && historicalData.items && historicalData.items.length >= 2) {
                const oldestPrice = historicalData.items[0].value;
                const newestPrice = historicalData.items[historicalData.items.length - 1].value;
                analysis.priceChange1h = ((newestPrice - oldestPrice) / oldestPrice) * 100;
                analysis.metrics.pricePoints = historicalData.items.length;
            }

            logger.token(JSON.stringify(analysis, null, 2));
            return analysis;
        } catch (error) {
            logger.error(`Token analysis failed: ${error.message}`);
            return null;
        }
    }
}

module.exports = new BirdeyeApi();