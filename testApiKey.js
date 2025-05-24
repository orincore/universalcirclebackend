// Script to generate a test API key for development purposes
require('dotenv').config();
const { generateDevApiKey } = require('./src/services/apiKeyService');

function createTestApiKey() {
  console.log('Generating development API key...');
  const result = generateDevApiKey('Test API Key');
  
  console.log('API Key generated successfully:');
  console.log('--------------------------------');
  console.log(`API Key: ${result.apiKey}`);
  console.log(`Created at: ${result.data.created_at}`);
  console.log('--------------------------------');
  console.log('You can use this key in the x-api-key header or api_key query parameter');
  console.log('Example:');
  console.log(`curl -X GET -H "x-api-key: ${result.apiKey}" http://localhost:5001/api/memes`);
  console.log(`curl -X GET "http://localhost:5001/api/memes?api_key=${result.apiKey}"`);
}

createTestApiKey(); 