const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

async function testTrendingCoins() {
  console.log('Testing CoinGecko trending coins integration...\n');
  
  try {
    // Get trending coins from CoinGecko
    console.log('Fetching trending coins from CoinGecko:');
    const trendingCoins = await coinGeckoAPI.getTrendingCoins();
    
    console.log(`\nFound ${trendingCoins.length} trending coins on CoinGecko\n`);
    
    // Display trending coins
    console.log('TOP TRENDING COINS:');
    console.log('==================');
    
    trendingCoins.forEach((coin, index) => {
      console.log(`\n${index + 1}. ${coin.name} (${coin.symbol.toUpperCase()})`);
      console.log(`   ID: ${coin.id}`);
      console.log(`   Market Cap Rank: ${coin.marketCapRank || 'N/A'}`);
      console.log(`   Score: ${coin.score || 'N/A'}`);
    });
    
    // Get detailed analysis for the top trending coin
    if (trendingCoins.length > 0) {
      const topCoin = trendingCoins[0];
      console.log(`\n\nDetailed analysis for top trending coin: ${topCoin.name}\n`);
      
      const analysis = await coinGeckoAPI.analyzePricePatterns(topCoin.id);
      
      if (analysis) {
        console.log(`Current Price: $${analysis.currentPrice}`);
        console.log(`24h Change: ${analysis.priceChange24h.toFixed(2)}%`);
        console.log(`7d Change: ${analysis.priceChange7d.toFixed(2)}%`);
        console.log(`Volatility: ${analysis.volatility.toFixed(2)}%`);
        console.log(`\nTechnical Indicators:`);
        console.log(`RSI (14): ${analysis.technicalIndicators.rsi.toFixed(2)}`);
        console.log(`MACD Line: ${analysis.technicalIndicators.macd.line.toFixed(6)}`);
        console.log(`MACD Signal: ${analysis.technicalIndicators.macd.signal.toFixed(6)}`);
        console.log(`MACD Histogram: ${analysis.technicalIndicators.macd.histogram.toFixed(6)}`);
        console.log(`SMA (7): ${analysis.technicalIndicators.sma.sma7.toFixed(6)}`);
        console.log(`SMA (25): ${analysis.technicalIndicators.sma.sma25.toFixed(6)}`);
        
        console.log(`\nIdentified Patterns:`);
        Object.entries(analysis.patterns).forEach(([pattern, value]) => {
          console.log(`${pattern}: ${value}`);
        });
        
        console.log(`\nOverall Score: ${analysis.score.toFixed(1)}/100`);
        console.log(`Recommendation: ${analysis.recommendation}`);
      } else {
        console.log('Analysis not available for this coin');
      }
    }
    
    console.log('\nTrending coins integration test complete');
  } catch (error) {
    console.error(`Error testing trending coins: ${error.message}`);
  }
}

testTrendingCoins().catch(console.error);
