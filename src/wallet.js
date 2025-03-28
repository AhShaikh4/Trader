const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');  // Changed import syntax
const config = require('./config');
const logger = require('./logger');

class WalletManager {
    constructor() {
        this.connection = new Connection(config.SOLANA_RPC_URL);
        this.keypair = null;
    }

    initialize() {
        try {
            if (!config.SOLANA_PRIVATE_KEY) {
                throw new Error('Solana private key not found in configuration');
            }
            
            const privateKeyBytes = bs58.default.decode(config.SOLANA_PRIVATE_KEY.trim());
            this.keypair = Keypair.fromSecretKey(privateKeyBytes);
            logger.high(`Wallet initialized with public key: ${this.keypair.publicKey.toString()}`);
            return true;
        } catch (error) {
            logger.error(`Failed to initialize wallet: ${error.message}`);
            return false;
        }
    }

    async getBalance() {
        try {
            if (!this.keypair) {
                throw new Error('Wallet not initialized');
            }
            
            const balance = await this.connection.getBalance(this.keypair.publicKey);
            const solBalance = balance / 1e9; // Convert lamports to SOL
            logger.deep(`Current wallet balance: ${solBalance} SOL`);
            return solBalance;
        } catch (error) {
            logger.error(`Failed to get balance: ${error.message}`);
            return null;
        }
    }
}

const walletManager = new WalletManager();
module.exports = walletManager;
