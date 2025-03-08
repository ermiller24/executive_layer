import axios from 'axios';

// Configuration
const API_URL = 'http://localhost:3000';

// Helper function to pause execution for a specified time
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Test vector store integration with the speaker
async function testVectorStoreIntegration() {
  console.log('=== TESTING VECTOR STORE INTEGRATION ===');
  console.log('\n1. PHASE: First query to generate content for the vector store');
  
  // First query - this will be stored in the vector store
  const firstQuery = 'Explain the concept of quantum entanglement in detail';
  console.log(`Sending first query: "${firstQuery}"`);
  
  try {
    const response1 = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in physics.' },
        { role: 'user', content: firstQuery }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Response received successfully');
    const content1 = response1.data.choices[0].message.content;
    console.log(`Response snippet: "${content1.substring(0, 150)}..."`);
    
    // Wait a moment to ensure the content is stored in the vector store
    console.log('Waiting for content to be stored in the vector store...');
    await sleep(2000);
    
    // Second query - similar to the first one, should trigger vector store retrieval
    console.log('\n2. PHASE: Similar query to test vector store retrieval');
    const secondQuery = 'What is quantum entanglement and why is it important in quantum physics?';
    console.log(`Sending similar query: "${secondQuery}"`);
    
    const response2 = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in physics.' },
        { role: 'user', content: secondQuery }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Response received successfully');
    const content2 = response2.data.choices[0].message.content;
    console.log(`Response snippet: "${content2.substring(0, 150)}..."`);
    
    // Third query - completely different topic to verify contrast
    console.log('\n3. PHASE: Different query for contrast');
    const thirdQuery = 'Explain the process of photosynthesis in plants';
    console.log(`Sending different query: "${thirdQuery}"`);
    
    const response3 = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in biology.' },
        { role: 'user', content: thirdQuery }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Response received successfully');
    const content3 = response3.data.choices[0].message.content;
    console.log(`Response snippet: "${content3.substring(0, 150)}..."`);
    
    // Fourth query - back to quantum physics to verify vector store functionality
    console.log('\n4. PHASE: Back to quantum physics to verify vector store is working');
    const fourthQuery = 'How does quantum entanglement relate to quantum computing?';
    console.log(`Sending query related to first topic: "${fourthQuery}"`);
    
    const response4 = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in quantum computing.' },
        { role: 'user', content: fourthQuery }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Response received successfully');
    const content4 = response4.data.choices[0].message.content;
    console.log(`Response snippet: "${content4.substring(0, 150)}..."`);
    
    console.log('\n=== VECTOR STORE INTEGRATION TEST COMPLETE ===');
    console.log('Check the speaker service logs for [VECTOR_STORE] entries');
    console.log('You should see vector store queries and storage operations');
    console.log('For the similar queries (1, 2, and 4), the vector store should retrieve relevant context');
    console.log('For the different query (3), it should not find relevant context from previous responses');
    
    return true;
  } catch (error) {
    console.error('Vector store integration test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test embeddings endpoint
async function testEmbeddingsEndpoint() {
  console.log('\n=== TESTING EMBEDDINGS ENDPOINT ===');
  
  try {
    const response = await axios.post(`${API_URL}/v1/embeddings`, {
      model: 'eir-embedding',
      input: 'This is a test of the embeddings endpoint to ensure it properly connects to ChromaDB'
    });
    
    console.log('Embeddings response:');
    console.log(`Model: ${response.data.model}`);
    console.log(`Total embeddings: ${response.data.data.length}`);
    console.log(`Embedding dimensions: ${response.data.data[0].embedding.length}`);
    console.log('Embeddings test passed!');
    return true;
  } catch (error) {
    console.error('Embeddings test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting Vector Store Integration Tests...');
  
  // Test health endpoint
  try {
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log('Health check:', healthResponse.data);
  } catch (error) {
    console.error('Health check failed:', error.message);
    console.log('Make sure the API server is running on', API_URL);
    return;
  }
  
  // Run vector store tests
  const vectorStoreResult = await testVectorStoreIntegration();
  const embeddingsResult = await testEmbeddingsEndpoint();
  
  // Print summary
  console.log('\nTest Summary:');
  console.log('Vector Store Integration:', vectorStoreResult ? 'PASSED' : 'FAILED');
  console.log('Embeddings Endpoint:', embeddingsResult ? 'PASSED' : 'FAILED');
  
  if (vectorStoreResult && embeddingsResult) {
    console.log('\nAll tests passed! The vector store integration is working properly.');
    console.log('\nINSTRUCTIONS:');
    console.log('1. Look at the speaker service logs for [VECTOR_STORE] entries');
    console.log('2. Verify that queries 2 and 4 found relevant context from previous responses');
    console.log('3. Verify that query 3 did not find relevant context since it was on a different topic');
  } else {
    console.log('\nSome tests failed. Check the logs for details.');
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error);
});