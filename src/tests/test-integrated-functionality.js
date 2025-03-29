const enhancedDiscovery = require('../enhanced-discovery');
const pricePrediction = require('../price-prediction');
const coinGeckoAPI = require('../coingecko');
const logger = require('../logger');

async function testIntegratedFunctionality() {
  console.log('Testing integrated CoinGecko functionality...\n');
  
  try {
    // Step 1: Test enhanced token discovery
    console.log('=== TESTING ENHANCED TOKEN DISCOVERY ===');
    console.log('Discovering profitable tokens using combined sources...');
    const discoveredTokens = await enhancedDiscovery.discoverProfitableTokens(10);
    
    console.log(`\nDiscovered ${discoveredTokens.length} tokens using enhanced discovery`);
    console.log('\nTOP DISCOVERED TOKENS:');
    console.log('======================');
    
    discoveredTokens.slice(0, 5).forEach((token, index) => {
      console.log(`\n${index + 1}. ${token.token.baseToken.symbol || 'Unknown'} (${token.token.baseToken.name || 'Unknown'})`);
      console.log(`   Source: ${token.source}`);
      console.log(`   Base Score: ${token.baseScore}`);
      console.log(`   Final Score: ${token.finalScore}`);
      console.log(`   Trending: ${token.isTrending ? 'Yes' : 'No'}`);
      
      if (token.token.priceUsd) {
        console.log(`   Price: $${token.token.priceUsd}`);
      }
      
      if (token.token.priceChange?.h24) {
        console.log(`   24h Change: ${token.token.priceChange.h24.toFixed(2)}%`);
      }
    });
    
    // Step 2: Test price prediction
    console.log('\n\n=== TESTING PRICE PREDICTION ===');
    
    // Select a few coins for prediction
    const coinsToPredictIds = [];
    
    // Add CoinGecko coins from discovered tokens
    for (const token of discoveredTokens) {
      if (token.source === 'coingecko' && token.coinGeckoData?.id) {
        coinsToPredictIds.push(token.coinGeckoData.id);
      }
    }
    
    // Add some well-known coins if we don't have enough
    if (coinsToPredictIds.length < 3) {
      const additionalCoins = ['bitcoin', 'ethereum', 'solana'].filter(
        id => !coinsToPredictIds.includes(id)
      );
      coinsToPredictIds.push(...additionalCoins.slice(0, 3 - coinsToPredictIds.length));
    }
    
    // Limit to 3 coins for testing
    const selectedCoins = coinsToPredictIds.slice(0, 3);
    console.log(`Generating price predictions for: ${selectedCoins.join(', ')}`);
    
    for (const coinId of selectedCoins) {
      console.log(`\nPredicting prices for ${coinId}...`);
      const prediction = await pricePrediction.predictPrice(coinId);
      
      if (prediction) {
        console.log('\nPRICE PREDICTIONS:');
        console.log('=================');
        
        for (const [timeframe, pred] of Object.entries(prediction.predictions)) {
          console.log(`\n${timeframe} Prediction:`);
          console.log(`   Current Price: $${pred.currentPrice.toFixed(6)}`);
          console.log(`   Predicted Price: $${pred.predictedPrice.toFixed(6)}`);
          console.log(`   Expected Change: ${pred.priceChange.toFixed(2)}%`);
          console.log(`   Price Range: $${pred.lowerBound.toFixed(6)} to $${pred.upperBound.toFixed(6)}`);
          console.log(`   Confidence: ${(pred.confidenceLevel * 100).toFixed(1)}%`);
        }
        
        console.log('\nTECHNICAL ANALYSIS:');
        console.log('==================');
        console.log(`   RSI (14): ${prediction.analysis.rsi.toFixed(2)}`);
        console.log(`   MACD Line: ${prediction.analysis.macd.line.toFixed(6)}`);
        console.log(`   MACD Signal: ${prediction.analysis.macd.signal.toFixed(6)}`);
        console.log(`   MACD Histogram: ${prediction.analysis.macd.histogram.toFixed(6)}`);
        console.log(`   Recommendation: ${prediction.analysis.recommendation}`);
      } else {
        console.log('Failed to generate prediction');
      }
    }
    
    // Step 3: Test API usage optimization
    console.log('\n\n=== TESTING API USAGE OPTIMIZATION ===');
    console.log('Making repeated API calls to test caching...');
    
    console.log('\nFirst call to getTrendingCoins:');
    const startTime1 = Date.now();
    await coinGeckoAPI.getTrendingCoins();
    console.log(`Time taken: ${Date.now() - startTime1}ms`);
    
    console.log('\nSecond call to getTrendingCoins (should use cache):');
    const startTime2 = Date.now();
    await coinGeckoAPI.getTrendingCoins();
    console.log(`Time taken: ${Date.now() - startTime2}ms`);
    
    console.log('\nFirst call to getCoinDetails for bitcoin:');
    const startTime3 = Date.now();
    await coinGeckoAPI.getCoinDetails('bitcoin');
    console.log(`Time taken: ${Date.now() - startTime3}ms`);
    
    console.log('\nSecond call to getCoinDetails for bitcoin (should use cache):');
    const startTime4 = Date.now();
    await coinGeckoAPI.getCoinDetails('bitcoin');
    console.log(`Time taken: ${Date.now() - startTime4}ms`);
    
    console.log('\nIntegrated functionality test complete');
  } catch (error) {
    console.error(`Error testing integrated functionality: ${error.message}`);
  }
}

testIntegratedFunctionality().catch(console.error);
