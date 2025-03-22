const { Connection } = require('@solana/web3.js');
const fetch = require('node-fetch');
const Decimal = require('decimal.js');
const config = require('./config');
const logger = require('./logger');

class JupiterApi {
    constructor() {
        this.connection = new Connection(config.SOLANA_RPC_URL);
        this.baseUrl = 'https://quote-api.jup.ag/v6';
        this.slippageBps = config.SLIPPAGE_BPS || 100; // Default 1% slippage
    }

    async getQuote(inputMint, outputMint, amount, slippageBps = this.slippageBps) {
        try {
            logger.deep(`Getting Jupiter quote for ${amount} tokens`);
            
            const response = await fetch(
                `${this.baseUrl}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Quote request failed with status ${response.status}: ${errorText}`);
            }

            const quoteResponse = await response.json();
            if (!quoteResponse) {
                throw new Error('No quote available for this swap');
            }

            logger.deep(`Quote received: ${JSON.stringify(quoteResponse)}`);
            return quoteResponse;
        } catch (error) {
            logger.error(`Failed to get Jupiter quote: ${error.message}`);
            return null;
        }
    }

    calculatePriceImpact(quote) {
        try {
            if (!quote || typeof quote.otherAmountThreshold === 'undefined') {
                return null;
            }

            // Calculate price impact based on output amount vs other amount threshold
            const outAmount = new Decimal(quote.outAmount);
            const threshold = new Decimal(quote.otherAmountThreshold);
            const impact = outAmount.minus(threshold).div(outAmount).times(100);
            
            logger.deep(`Price impact calculated: ${impact}%`);
            return Math.abs(impact.toNumber());
        } catch (error) {
            logger.error(`Failed to calculate price impact: ${error.message}`);
            return null;
        }
    }

    async findBestRoute(inputMint, outputMint, amount) {
        try {
            logger.deep(`Finding best route for ${amount} tokens`);
            const quote = await this.getQuote(inputMint, outputMint, amount);
            
            if (!quote) {
                throw new Error('Could not find a valid route');
            }

            const priceImpact = this.calculatePriceImpact(quote);
            const analysis = {
                route: quote.routePlan,
                outAmount: quote.outAmount,
                priceImpact: priceImpact,
                inAmount: quote.inAmount,
                valid: priceImpact !== null && priceImpact <= 5, // Consider routes with <= 5% price impact
                routeMap: quote.routePlan.map(hop => ({
                    protocol: hop.swapInfo?.label || 'Unknown',
                    inputMint: hop.swapInfo?.inputMint || 'Unknown',
                    outputMint: hop.swapInfo?.outputMint || 'Unknown'
                }))
            };

            logger.token(JSON.stringify(analysis, null, 2));
            return analysis;
        } catch (error) {
            logger.error(`Failed to find best route: ${error.message}`);
            return null;
        }
    }
}

module.exports = new JupiterApi();