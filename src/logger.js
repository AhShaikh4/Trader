const fs = require('fs');
const path = require('path');

const LOG_FILES = {
  ERROR: 'errors.log',
  DEEP: 'deep.log',
  HIGH_LEVEL: 'high_level.log',
  TOKENS: 'tokens.log'
};

class Logger {
  constructor() {
    this.initializeLogs();
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
    return `[${timestamp} EST] [${logType}] ${message}\n`;
  }

  log(type, message) {
    const logEntry = this.formatLogEntry(type, message);
    fs.appendFileSync(LOG_FILES[type], logEntry);
  }

  error(message) { this.log('ERROR', message); }
  deep(message) { this.log('DEEP', message); }
  high(message) { this.log('HIGH_LEVEL', message); }
  token(message) { this.log('TOKENS', message); }
}

module.exports = new Logger();
