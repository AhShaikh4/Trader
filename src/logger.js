const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const LOG_FILES = {
  ERROR: 'errors.log',
  DEEP: 'deep.log',
  HIGH_LEVEL: 'high_level.log',
  TOKENS: 'tokens.log'
};

class Logger {
  constructor() {
    this.initializeLogs();
    this.tokenSymbolCache = new Map(); // Cache to store address -> symbol mappings
  }

  initializeLogs() {
    Object.values(LOG_FILES).forEach(file => {
      fs.writeFileSync(file, ''); // Clear/create log files on startup
    });
  }

  getFormattedTimestamp() {
    const date = new Date();
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  formatLogEntry(type, message) {
    const timestamp = this.getFormattedTimestamp();
    const logType = type.padEnd(10); // Align log types
    
    // Add color and formatting based on log type
    let formattedMessage = message;
    
    // Replace token addresses with symbols if available
    formattedMessage = this.replaceAddressesWithSymbols(formattedMessage);
    
    return `[${timestamp} EST] [${logType}] ${formattedMessage}\n`;
  }

  // Store token address -> symbol mapping
  registerTokenSymbol(address, symbol) {
    if (address && symbol) {
      this.tokenSymbolCache.set(address.toLowerCase(), symbol);
    }
  }

  // Replace token addresses with symbols in log messages
  replaceAddressesWithSymbols(message) {
    if (!message || typeof message !== 'string') return message;
    
    // Replace known addresses with their symbols
    this.tokenSymbolCache.forEach((symbol, address) => {
      const regex = new RegExp(address, 'gi');
      message = message.replace(regex, `${symbol} (${address.substring(0, 6)}...)`);
    });
    
    return message;
  }

  // Format token data for more aesthetic display
  formatTokenData(tokenData) {
    if (!tokenData) return 'No token data available';
    
    try {
      // If tokenData is a string (JSON), parse it
      const data = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;
      
      // Register the token symbol if available
      if (data.address && data.symbol) {
        this.registerTokenSymbol(data.address, data.symbol);
      }
      
      // Create a formatted string with token details
      let formatted = '╔════════════════════════════════════════════════════════════════╗\n';
      formatted += `║ TOKEN: ${data.symbol || 'Unknown'} ${data.name ? `(${data.name})` : ''} ${data.address ? `[${data.address.substring(0, 8)}...]` : ''} ║\n`;
      formatted += '╠════════════════════════════════════════════════════════════════╣\n';
      
      // Add price information
      if (data.price !== undefined) {
        formatted += `║ Price: $${parseFloat(data.price).toFixed(8).padEnd(15)} `;
        
        // Add price change if available
        if (data.priceChange !== undefined) {
          const change = parseFloat(data.priceChange);
          const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
          formatted += `Change: ${changeStr.padEnd(10)}`;
        }
        formatted += ' ║\n';
      }
      
      // Add volume and liquidity
      if (data.volume !== undefined || data.liquidity !== undefined) {
        formatted += '║ ';
        if (data.volume !== undefined) {
          formatted += `Volume: $${this.formatNumber(data.volume).padEnd(15)} `;
        }
        if (data.liquidity !== undefined) {
          formatted += `Liquidity: $${this.formatNumber(data.liquidity).padEnd(15)}`;
        }
        formatted += ' ║\n';
      }
      
      // Add market cap and holders if available
      if (data.marketCap !== undefined || data.holders !== undefined) {
        formatted += '║ ';
        if (data.marketCap !== undefined) {
          formatted += `Market Cap: $${this.formatNumber(data.marketCap).padEnd(15)} `;
        }
        if (data.holders !== undefined) {
          formatted += `Holders: ${data.holders.toString().padEnd(10)}`;
        }
        formatted += ' ║\n';
      }
      
      // Add score or rating if available
      if (data.score !== undefined) {
        formatted += `║ Score: ${data.score}/10 ${this.getScoreEmoji(data.score)} `;
        
        // Add recommendation based on score
        formatted += `Recommendation: ${this.getRecommendation(data.score).padEnd(20)}`;
        formatted += ' ║\n';
      }
      
      // Add exchange info if available
      if (data.exchange) {
        formatted += `║ Exchange: ${data.exchange.padEnd(42)} ║\n`;
      }
      
      // Add creation time or age if available
      if (data.createdAt || data.age) {
        formatted += `║ Age: ${data.age || data.createdAt || 'Unknown'.padEnd(44)} ║\n`;
      }
      
      formatted += '╚════════════════════════════════════════════════════════════════╝\n';
      
      return formatted;
    } catch (error) {
      this.error(`Error formatting token data: ${error.message}`);
      return tokenData; // Return original if formatting fails
    }
  }
  
  // Helper to format numbers with K, M, B suffixes
  formatNumber(num) {
    if (num === undefined || num === null) return 'N/A';
    
    const n = parseFloat(num);
    if (isNaN(n)) return 'N/A';
    
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
  }
  
  // Get emoji based on score
  getScoreEmoji(score) {
    const numScore = parseFloat(score);
    if (numScore >= 8) return '🔥';
    if (numScore >= 6) return '👍';
    if (numScore >= 4) return '⚠️';
    return '❌';
  }
  
  // Get recommendation based on score
  getRecommendation(score) {
    const numScore = parseFloat(score);
    if (numScore >= 8) return 'Strong Buy';
    if (numScore >= 6) return 'Buy';
    if (numScore >= 4) return 'Hold';
    if (numScore >= 2) return 'Sell';
    return 'Strong Sell';
  }

  log(type, message) {
    const logEntry = this.formatLogEntry(type, message);
    fs.appendFileSync(LOG_FILES[type], logEntry);
    
    // Also print to console with colors
    let consoleMessage;
    switch(type) {
      case 'ERROR':
        consoleMessage = `🔴 ${message}`;
        break;
      case 'HIGH_LEVEL':
        consoleMessage = `🟢 ${message}`;
        break;
      case 'DEEP':
        consoleMessage = `🔵 ${message}`;
        break;
      case 'TOKENS':
        consoleMessage = `🟡 ${message}`;
        break;
      default:
        consoleMessage = message;
    }
    
    console.log(consoleMessage);
  }

  error(message) { this.log('ERROR', message); }
  deep(message) { this.log('DEEP', message); }
  high(message) { this.log('HIGH_LEVEL', message); }
  
  // Enhanced token logging
  token(message) { 
    // Check if this is token data that should be formatted
    if (message.includes('{') && message.includes('}')) {
      try {
        const tokenData = JSON.parse(message);
        this.log('TOKENS', this.formatTokenData(tokenData));
      } catch (e) {
        // If not valid JSON, log as is
        this.log('TOKENS', message);
      }
    } else {
      this.log('TOKENS', message);
    }
  }
}

module.exports = new Logger();
