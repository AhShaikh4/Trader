const { createClient } = require('graphql-ws');
const axios = require('axios');
const logger = require('./logger');
require('dotenv').config();

class BitqueryAPI {
    constructor() {
        this.baseUrl = 'https://graphql.bitquery.io';
        this.wsUrl = 'wss://graphql.bitquery.io/graphql';
        this.headers = {
            'Authorization': `Bearer ${process.env.BITQUERY_OAUTH_TOKEN}`
        };
        this.minLiquidity = 10000; // $10k minimum liquidity
        this.minUniqueBuyers = 50;
        this.minBuySellRatio = 2;
        this.profitTarget = 1.1; // 10% profit target
        
        this.wsClient = createClient({
            url: this.wsUrl,
            connectionParams: { headers: this.headers }
        });

        this.activeSubscriptions = new Map();
    }

    async startTokenDiscovery(onNewToken) {
        const pumpFunQuery = `
            subscription {
                Solana {
                    TokenSupplyUpdates(
                        where: {Instruction: {Program: {Address: {is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"}, Method: {is: "create"}}}
                    }) {
                        TokenSupplyUpdate {
                            Currency {
                                MintAddress
                                Name
                                Symbol
                            }
                        }
                    }
                }
            }
        `;

        logger.deep('Starting Bitquery token discovery subscription');
        return this.wsClient.subscribe(
            { query: pumpFunQuery },
            {
                next: async ({ data }) => {
                    try {
                        const token = data.Solana.TokenSupplyUpdates.TokenSupplyUpdate.Currency;
                        logger.deep(`New token discovered: ${token.Symbol} (${token.MintAddress})`);
                        
                        if (onNewToken) {
                            await onNewToken(token);
                        }
                    } catch (error) {
                        logger.error(`Error processing new token: ${error.message}`);
                    }
                },
                error: (err) => {
                    logger.error(`Token discovery subscription error: ${err.message}`);
                    this.reconnectWebSocket();
                },
                complete: () => {
                    logger.deep('Token discovery subscription completed');
                }
            }
        );
    }

    async checkLiquidityPool(tokenAddress) {
        const query = `
            query ($tokenAddress: String!) {
                Solana {
                    DEXPools(
                        where: {Pool: {Base: {MintAddress: {is: $tokenAddress}}}}
                    ) {
                        Pool {
                            PostAmountInUSD
                            Exchange {
                                FullName
                            }
                        }
                    }
                }
            }
        `;

        try {
            logger.deep(`Checking liquidity for token ${tokenAddress}`);
            const response = await axios.post(
                this.baseUrl,
                {
                    query,
                    variables: { tokenAddress }
                },
                { headers: this.headers }
            );

            const pools = response.data?.data?.Solana?.DEXPools || [];
            const totalLiquidity = pools.reduce((sum, p) => sum + (p.Pool.PostAmountInUSD || 0), 0);
            
            logger.deep(`Token ${tokenAddress} total liquidity: $${totalLiquidity}`);
            return {
                hasLiquidity: totalLiquidity >= this.minLiquidity,
                liquidity: totalLiquidity,
                exchanges: pools.map(p => p.Pool.Exchange.FullName)
            };
        } catch (error) {
            logger.error(`Failed to check liquidity: ${error.message}`);
            return { hasLiquidity: false, liquidity: 0, exchanges: [] };
        }
    }

    startTradeAnalysis(tokenAddress, onTradeUpdate) {
        const tradeQuery = `
            subscription ($tokenAddress: String!) {
                Solana {
                    DEXTrades(
                        where: {Trade: {Pair: {Token: {Address: {is: $tokenAddress}}}}}
                    ) {
                        Trade {
                            Side
                            AmountInUSD
                            Buyer
                            Seller
                            PriceInUSD
                            Block {
                                Timestamp
                            }
                        }
                    }
                }
            }
        `;

        logger.deep(`Starting trade analysis for ${tokenAddress}`);
        const analysis = {
            buyVolume: 0,
            sellVolume: 0,
            uniqueBuyers: new Set(),
            uniqueSellers: new Set(),
            lastPrice: 0,
            startTime: Date.now()
        };

        const subscription = this.wsClient.subscribe(
            { query: tradeQuery, variables: { tokenAddress } },
            {
                next: ({ data }) => {
                    try {
                        const trade = data.Solana.DEXTrades.Trade;
                        analysis.lastPrice = trade.PriceInUSD;

                        if (trade.Side === 'Buy') {
                            analysis.buyVolume += trade.AmountInUSD;
                            analysis.uniqueBuyers.add(trade.Buyer);
                        } else {
                            analysis.sellVolume += trade.AmountInUSD;
                            analysis.uniqueSellers.add(trade.Seller);
                        }

                        const metrics = {
                            buySellRatio: analysis.sellVolume ? analysis.buyVolume / analysis.sellVolume : Infinity,
                            uniqueBuyerCount: analysis.uniqueBuyers.size,
                            uniqueSellerCount: analysis.uniqueSellers.size,
                            totalVolume: analysis.buyVolume + analysis.sellVolume,
                            currentPrice: analysis.lastPrice
                        };

                        logger.token(JSON.stringify({
                            tokenAddress,
                            metrics,
                            timestamp: new Date().toISOString()
                        }, null, 2));

                        if (onTradeUpdate) {
                            onTradeUpdate(metrics);
                        }
                    } catch (error) {
                        logger.error(`Error processing trade update: ${error.message}`);
                    }
                },
                error: (err) => {
                    logger.error(`Trade analysis subscription error: ${err.message}`);
                    this.reconnectWebSocket();
                }
            }
        );

        this.activeSubscriptions.set(tokenAddress, subscription);
        return analysis;
    }

    async getHolderDistribution(tokenAddress) {
        const query = `
            query ($tokenAddress: String!) {
                Solana {
                    BalanceUpdates(
                        where: {BalanceUpdate: {Currency: {MintAddress: {is: $tokenAddress}}}}
                        orderBy: {BalanceUpdate: {Balance: DESC}}
                        limit: 10
                    ) {
                        BalanceUpdate {
                            Account {
                                Address
                            }
                            Balance
                        }
                    }
                }
            }
        `;

        try {
            logger.deep(`Analyzing holder distribution for ${tokenAddress}`);
            const response = await axios.post(
                this.baseUrl,
                {
                    query,
                    variables: { tokenAddress }
                },
                { headers: this.headers }
            );

            const holders = response.data?.data?.Solana?.BalanceUpdates || [];
            const distribution = holders.map(h => ({
                address: h.BalanceUpdate.Account.Address,
                balance: h.BalanceUpdate.Balance
            }));

            logger.deep(`Found ${distribution.length} significant holders for ${tokenAddress}`);
            return distribution;
        } catch (error) {
            logger.error(`Failed to get holder distribution: ${error.message}`);
            return [];
        }
    }

    stopTradeAnalysis(tokenAddress) {
        const subscription = this.activeSubscriptions.get(tokenAddress);
        if (subscription) {
            subscription.unsubscribe();
            this.activeSubscriptions.delete(tokenAddress);
            logger.deep(`Stopped trade analysis for ${tokenAddress}`);
        }
    }

    reconnectWebSocket() {
        try {
            this.wsClient = createClient({
                url: this.wsUrl,
                connectionParams: { headers: this.headers }
            });
            logger.deep('WebSocket connection reestablished');
        } catch (error) {
            logger.error(`WebSocket reconnection failed: ${error.message}`);
        }
    }

    cleanup() {
        for (const [tokenAddress, subscription] of this.activeSubscriptions) {
            subscription.unsubscribe();
            logger.deep(`Cleaned up subscription for ${tokenAddress}`);
        }
        this.activeSubscriptions.clear();
    }
}

module.exports = new BitqueryAPI();