const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

async function testHistoricalDataAnalysis() {
  console.log('Testing CoinGecko historical data analysis...\n');
  
  try {
    // Define coins to analyze
    const coinsToAnalyze = ['bitcoin', 'solana', 'ethereum', 'dogecoin'];
    
    for (const coinId of coinsToAnalyze) {
      console.log(`\n=== Analyzing historical data for ${coinId} ===\n`);
      
      // Get market chart data
      console.log(`Fetching market chart data (7 days)...`);
      const marketData = await coinGeckoAPI.getCoinMarketChart(coinId);
      
      if (marketData && marketData.prices) {
        const pricePoints = marketData.prices.length;
        const volumePoints = marketData.total_volumes.length;
        
        console.log(`Retrieved ${pricePoints} price data points and ${volumePoints} volume data points`);
        
        // Display sample of price data
        console.log('\nSample price data (last 5 points):');
        marketData.prices.slice(-5).forEach(([timestamp, price]) => {
          const date = new Date(timestamp).toLocaleString();
          console.log(`${date}: $${price.toFixed(2)}`);
        });
        
        // Display sample of volume data
        console.log('\nSample volume data (last 5 points):');
        marketData.total_volumes.slice(-5).forEach(([timestamp, volume]) => {
          const date = new Date(timestamp).toLocaleString();
          console.log(`${date}: $${volume.toLocaleString()}`);
        });
      } else {
        console.log('Failed to retrieve market chart data');
      }
      
      // Get OHLC data
      console.log('\nFetching OHLC data (7 days)...');
      const ohlcData = await coinGeckoAPI.getCoinOHLC(coinId);
      
      if (ohlcData && ohlcData.length > 0) {
        console.log(`Retrieved ${ohlcData.length} OHLC candles`);
        
        // Display sample of OHLC data
        console.log('\nSample OHLC data (last 5 candles):');
        ohlcData.slice(-5).forEach(([timestamp, open, high, low, close]) => {
          const date = new Date(timestamp).toLocaleString();
          console.log(`${date}: Open: $${open.toFixed(2)}, High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, Close: $${close.toFixed(2)}`);
        });
      } else {
        console.log('Failed to retrieve OHLC data');
      }
      
      // Perform technical analysis
      console.log('\nPerforming technical analysis...');
      const analysis = await coinGeckoAPI.analyzePricePatterns(coinId);
      
      if (analysis) {
        console.log('\nTechnical Analysis Results:');
        console.log(`Current Price: $${analysis.currentPrice.toFixed(2)}`);
        console.log(`24h Change: ${analysis.priceChange24h.toFixed(2)}%`);
        console.log(`7d Change: ${analysis.priceChange7d.toFixed(2)}%`);
        console.log(`Volatility: ${analysis.volatility.toFixed(2)}%`);
        
        console.log('\nTechnical Indicators:');
        console.log(`RSI (14): ${analysis.technicalIndicators.rsi.toFixed(2)}`);
        console.log(`MACD Line: ${analysis.technicalIndicators.macd.line.toFixed(6)}`);
        console.log(`MACD Signal: ${analysis.technicalIndicators.macd.signal.toFixed(6)}`);
        console.log(`MACD Histogram: ${analysis.technicalIndicators.macd.histogram.toFixed(6)}`);
        console.log(`SMA (7): ${analysis.technicalIndicators.sma.sma7.toFixed(6)}`);
        console.log(`SMA (25): ${analysis.technicalIndicators.sma.sma25.toFixed(6)}`);
        
        console.log('\nIdentified Patterns:');
        Object.entries(analysis.patterns).forEach(([pattern, value]) => {
          console.log(`${pattern}: ${value}`);
        });
        
        console.log(`\nOverall Score: ${analysis.score.toFixed(1)}/100`);
        console.log(`Recommendation: ${analysis.recommendation}`);
      } else {
        console.log('Analysis not available for this coin');
      }
    }
    
    console.log('\nHistorical data analysis test complete');
  } catch (error) {
    console.error(`Error testing historical data analysis: ${error.message}`);
  }
}

testHistoricalDataAnalysis().catch(console.error);
