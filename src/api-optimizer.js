const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

// API usage optimization strategies
class ApiOptimizer {
  constructor() {
    this.requestCounts = {
      total: 0,
      byEndpoint: new Map(),
      byHour: new Map()
    };
    this.lastOptimizationTime = 0;
    this.optimizationInterval = 10 * 60 * 1000; // 10 minutes
    this.hourlyLimit = 500; // Conservative estimate for free tier
    this.monthlyLimit = 10000; // Free tier limit
    this.monthlyUsage = 0;
    this.monthStartTime = this.getCurrentMonthStart();
  }
  
  // Track API request
  trackRequest(endpoint) {
    const now = Date.now();
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    
    // Track total requests
    this.requestCounts.total++;
    
    // Track by endpoint
    if (!this.requestCounts.byEndpoint.has(endpoint)) {
      this.requestCounts.byEndpoint.set(endpoint, 0);
    }
    this.requestCounts.byEndpoint.set(
      endpoint, 
      this.requestCounts.byEndpoint.get(endpoint) + 1
    );
    
    // Track by hour
    if (!this.requestCounts.byHour.has(currentHour)) {
      this.requestCounts.byHour.set(currentHour, 0);
    }
    this.requestCounts.byHour.set(
      currentHour,
      this.requestCounts.byHour.get(currentHour) + 1
    );
    
    // Check if we're in a new month
    if (now >= this.monthStartTime + (30 * 24 * 60 * 60 * 1000)) {
      this.monthStartTime = this.getCurrentMonthStart();
      this.monthlyUsage = 0;
    }
    
    // Track monthly usage
    this.monthlyUsage++;
    
    // Clean up old hourly data
    this.cleanupHourlyData();
    
    // Return current usage statistics
    return {
      currentHourUsage: this.requestCounts.byHour.get(currentHour) || 0,
      monthlyUsage: this.monthlyUsage,
      totalTracked: this.requestCounts.total
    };
  }
  
  // Get current month start timestamp
  getCurrentMonthStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  
  // Clean up old hourly data
  cleanupHourlyData() {
    const now = Date.now();
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    
    // Keep only the last 24 hours of data
    for (const hour of this.requestCounts.byHour.keys()) {
      if (hour < currentHour - 24) {
        this.requestCounts.byHour.delete(hour);
      }
    }
  }
  
  // Check if we should throttle requests
  shouldThrottle() {
    const now = Date.now();
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    const currentHourUsage = this.requestCounts.byHour.get(currentHour) || 0;
    
    // Check hourly limit
    if (currentHourUsage >= this.hourlyLimit) {
      logger.deep(`Hourly API usage limit reached: ${currentHourUsage}/${this.hourlyLimit}`);
      return true;
    }
    
    // Check monthly limit (with 5% buffer)
    if (this.monthlyUsage >= this.monthlyLimit * 0.95) {
      logger.deep(`Monthly API usage limit approaching: ${this.monthlyUsage}/${this.monthlyLimit}`);
      return true;
    }
    
    return false;
  }
  
  // Get recommended wait time if throttling is needed
  getThrottleWaitTime() {
    const now = Date.now();
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    const currentHourUsage = this.requestCounts.byHour.get(currentHour) || 0;
    
    if (currentHourUsage >= this.hourlyLimit) {
      // Wait until next hour
      const nextHourStart = (currentHour + 1) * 60 * 60 * 1000;
      return nextHourStart - now + 1000; // Add 1 second buffer
    }
    
    // Default wait time
    return 60000; // 1 minute
  }
  
  // Optimize API usage
  async optimizeApiUsage() {
    const now = Date.now();
    
    // Only run optimization periodically
    if (now - this.lastOptimizationTime < this.optimizationInterval) {
      return;
    }
    
    this.lastOptimizationTime = now;
    logger.high('Running API usage optimization');
    
    // Analyze usage patterns
    const currentHour = Math.floor(now / (60 * 60 * 1000));
    const currentHourUsage = this.requestCounts.byHour.get(currentHour) || 0;
    const hourlyAverage = this.calculateHourlyAverage();
    
    // Calculate usage statistics
    const stats = {
      currentHourUsage,
      hourlyAverage,
      monthlyUsage: this.monthlyUsage,
      monthlyProjection: this.projectMonthlyUsage(hourlyAverage),
      mostUsedEndpoints: this.getMostUsedEndpoints(5)
    };
    
    // Log usage statistics
    logger.high(`API Usage Stats: ${currentHourUsage} requests this hour, ${this.monthlyUsage} this month`);
    logger.deep(`Hourly average: ${hourlyAverage.toFixed(2)} requests`);
    logger.deep(`Monthly projection: ${stats.monthlyProjection} requests`);
    
    logger.deep('Most used endpoints:');
    stats.mostUsedEndpoints.forEach(([endpoint, count]) => {
      logger.deep(`  ${endpoint}: ${count} requests`);
    });
    
    // Adjust cache expiry times based on usage
    this.adjustCacheSettings(stats);
    
    return stats;
  }
  
  // Calculate hourly average usage
  calculateHourlyAverage() {
    if (this.requestCounts.byHour.size === 0) {
      return 0;
    }
    
    let total = 0;
    let count = 0;
    
    for (const usage of this.requestCounts.byHour.values()) {
      total += usage;
      count++;
    }
    
    return total / count;
  }
  
  // Project monthly usage based on hourly average
  projectMonthlyUsage(hourlyAverage) {
    return Math.round(hourlyAverage * 24 * 30); // 30 days
  }
  
  // Get most used endpoints
  getMostUsedEndpoints(limit = 5) {
    const endpoints = Array.from(this.requestCounts.byEndpoint.entries());
    endpoints.sort((a, b) => b[1] - a[1]); // Sort by count descending
    return endpoints.slice(0, limit);
  }
  
  // Adjust cache settings based on usage patterns
  adjustCacheSettings(stats) {
    // If we're projected to exceed monthly limit, increase cache times
    if (stats.monthlyProjection > this.monthlyLimit * 0.8) {
      logger.high('Increasing cache expiry times due to high projected usage');
      coinGeckoAPI.cacheExpiryTime = 15 * 60 * 1000; // 15 minutes
      return;
    }
    
    // If usage is moderate, use standard cache times
    if (stats.monthlyProjection > this.monthlyLimit * 0.5) {
      logger.high('Using standard cache expiry times');
      coinGeckoAPI.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
      return;
    }
    
    // If usage is low, use shorter cache times for fresher data
    logger.high('Using shorter cache expiry times due to low usage');
    coinGeckoAPI.cacheExpiryTime = 3 * 60 * 1000; // 3 minutes
  }
  
  // Get optimization recommendations
  getOptimizationRecommendations() {
    const stats = {
      monthlyUsage: this.monthlyUsage,
      monthlyLimit: this.monthlyLimit,
      hourlyAverage: this.calculateHourlyAverage(),
      mostUsedEndpoints: this.getMostUsedEndpoints(3)
    };
    
    const recommendations = [];
    
    // Check if we're approaching monthly limit
    if (stats.monthlyUsage > this.monthlyLimit * 0.7) {
      recommendations.push({
        priority: 'high',
        type: 'reduce_frequency',
        message: 'Reduce API call frequency to avoid hitting monthly limit',
        action: 'Increase minimum time between API calls'
      });
    }
    
    // Check if certain endpoints are used too frequently
    if (stats.mostUsedEndpoints.length > 0 && stats.mostUsedEndpoints[0][1] > 100) {
      recommendations.push({
        priority: 'medium',
        type: 'endpoint_overuse',
        message: `Endpoint ${stats.mostUsedEndpoints[0][0]} is used excessively`,
        action: 'Increase cache time for this specific endpoint'
      });
    }
    
    // Check if hourly average is too high
    if (stats.hourlyAverage > this.hourlyLimit * 0.7) {
      recommendations.push({
        priority: 'high',
        type: 'hourly_limit',
        message: 'Hourly usage is approaching limit',
        action: 'Implement request batching or increase throttling'
      });
    }
    
    return {
      stats,
      recommendations
    };
  }
}

const apiOptimizer = new ApiOptimizer();
module.exports = apiOptimizer;
