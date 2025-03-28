const Moralis = require('moralis').default;
const { SolApi } = require('@moralisweb3/common-sol-utils');
const logger = require('./logger');

// Initialize Moralis with API key
const initMoralis = async () => {
  try {
    await Moralis.start({
      apiKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjA4ZjAyZGU3LTdlOGUtNDFhNi1iMDNlLWI5MWI3ZWM1ODg0MCIsIm9yZ0lkIjoiNDM4MTE2IiwidXNlcklkIjoiNDUwNzE4IiwidHlwZUlkIjoiMGQxZjZjMjQtMDQ4Ny00Mzg1LWIxZWEtOTU0NWY5MTYwYjUyIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NDI5NDI0NDcsImV4cCI6NDg5ODcwMjQ0N30.hQpurqQz3epWRzVuqVU4QNtIp9h5mnopFNy69bRhVlE"
    });
    logger.deep("Moralis initialized successfully");
  } catch (error) {
    logger.error(`Error initializing Moralis: ${error.message}`);
    throw error;
  }
};

// Get token metadata for a specific token
const getTokenMetadata = async (network, address) => {
  try {
    const response = await Moralis.SolApi.token.getTokenMetadata({
      "network": network,
      "address": address
    });
    return response.raw;
  } catch (error) {
    logger.error(`Error getting token metadata: ${error.message}`);
    return null;
  }
};

// Get token price for a specific token
const getTokenPrice = async (network, address) => {
  try {
    const response = await Moralis.SolApi.token.getTokenPrice({
      "network": network,
      "address": address
    });
    return response.raw;
  } catch (error) {
    logger.error(`Error getting token price: ${error.message}`);
    return null;
  }
};

module.exports = {
  initMoralis,
  getTokenMetadata,
  getTokenPrice
};
