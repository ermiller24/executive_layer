import axios from 'axios';

// Configuration
const API_URL = 'http://localhost:3000';
const EXECUTIVE_URL = 'http://localhost:8001';

// Helper function to pause execution for a specified time
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Test the interaction between speaker and executive using direct API calls
async function testExecutiveInteraction() {
  console.log('=== TESTING SPEAKER-EXECUTIVE INTERACTION ===');
  
  try {
    // First, add knowledge to the graph about Paris
    console.log('Adding knowledge about Paris to the knowledge graph...');
    await axios.post(`${EXECUTIVE_URL}/debug/query`, {
      query: "Check your knowledge graph to see if there is information about Paris, the capital of france. If it is missing, create a topic node about Paris, the capital of France, and add knowledge that it's the capital city of France and is known for the Eiffel Tower."
    }).catch(error => {
      console.warn('Warning: Could not add knowledge to graph. Debug mode may be disabled.');
    });
    
    // Wait for the knowledge to be added
    await sleep(1000);
    
    // Test 1: Direct test with correct information - Executive should not interrupt
    console.log('\n1. Testing with correct information (no interruption expected)');
    
    const correctResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: 'What is the capital of France?',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in geography.' },
        { role: 'user', content: 'What is the capital of France?' }
      ],
      speaker_output: 'The capital of France is Paris. Paris is known for landmarks such as the Eiffel Tower and the Louvre Museum.'
    });
    
    console.log('Executive evaluation response:', correctResponse.data);
    const correctAction = correctResponse.data.action;
    console.log(`Executive action: ${correctAction}`);
    console.log(`Test 1 ${correctAction === 'none' ? 'PASSED' : 'FAILED'} - Expected no interruption`);
    
    // Wait a moment before the next test
    await sleep(1000);
    
    // Test 2: Direct test with incorrect information - Executive should interrupt
    console.log('\n2. Testing with incorrect information (interruption expected)');
    
    const incorrectResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: 'What is the capital of France?',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in geography.' },
        { role: 'user', content: 'What is the capital of France?' }
      ],
      speaker_output: 'The capital of France is Lyon. Lyon is the third-largest city in France and serves as the country\'s administrative center.'
    });
    
    console.log('Executive evaluation response:', incorrectResponse.data);
    const incorrectAction = incorrectResponse.data.action;
    console.log(`Executive action: ${incorrectAction}`);
    console.log(`Test 2 ${incorrectAction !== 'none' ? 'PASSED' : 'FAILED'} - Expected interruption or restart`);
    
    // Test 3: Simulated streaming with progressive incorrect information
    console.log('\n3. Testing with progressive incorrect information (interruption expected)');
    
    // Simulate a streaming response by sending partial outputs
    const partialOutputs = [
      'The capital of France is a beautiful city. ',
      'It\'s located in the north-central part of the country. ',
      'The city is Lyon, which sits at the confluence of the Rhône and Saône rivers. ',
      'Lyon has been an important urban center since Roman times.'
    ];
    
    let accumulatedOutput = '';
    let interruptionDetected = false;
    
    for (const [index, partial] of partialOutputs.entries()) {
      // Skip if interruption already detected
      if (interruptionDetected) continue;
      
      // Add to accumulated output
      accumulatedOutput += partial;
      console.log(`Partial output ${index + 1}:`, accumulatedOutput);
      
      // Check with executive
      const streamResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
        original_query: 'What is the capital of France?',
        messages: [
          { role: 'system', content: 'You are a helpful assistant with expertise in geography.' },
          { role: 'user', content: 'What is the capital of France?' }
        ],
        speaker_output: accumulatedOutput
      });
      
      console.log(`Executive response for part ${index + 1}:`, streamResponse.data.action);
      
      // Check if executive wants to interrupt
      if (streamResponse.data.action !== 'none') {
        interruptionDetected = true;
        console.log('Executive interruption detected at part', index + 1);
        console.log('Interruption reason:', streamResponse.data.reason);
        console.log('Knowledge document:', streamResponse.data.knowledge_document);
      }
      
      // Wait a moment before the next part
      await sleep(500);
    }
    
    console.log(`Test 3 ${interruptionDetected ? 'PASSED' : 'FAILED'} - Expected interruption during streaming`);
    
    // Test 4: Completely off-topic response - Executive should restart
    console.log('\n4. Testing with completely off-topic response (restart expected)');
    
    const offtopicResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: 'What is the capital of France?',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with expertise in geography.' },
        { role: 'user', content: 'What is the capital of France?' }
      ],
      speaker_output: 'The Eiffel Tower is made of iron and was completed in 1889. It was built for the 1889 World\'s Fair in Paris. The tower stands 324 meters tall and was the tallest man-made structure in the world for 41 years until the Chrysler Building in New York was completed in 1930. It\'s named after Gustave Eiffel, whose company designed and built the tower.'
    });
    
    console.log('Executive evaluation response:', offtopicResponse.data);
    const offtopicAction = offtopicResponse.data.action;
    console.log(`Executive action: ${offtopicAction}`);
    console.log(`Test 4 ${offtopicAction === 'restart' ? 'PASSED' : 'FAILED'} - Expected restart`);
    
    // Wait a moment before the next test
    await sleep(1000);
    
    // Test 5: Integration test with the actual speaker API
    console.log('\n5. Testing actual speaker API (informational only)');
    
    try {
      const response = await axios.post(`${API_URL}/v1/chat/completions`, {
        model: 'eir-default',
        messages: [
          { role: 'system', content: 'You are a helpful assistant with expertise in geography.' },
          { role: 'user', content: 'What is the capital of France?' }
        ],
        temperature: 0.7,
        stream: false
      });
      
      console.log('Response received successfully');
      const content = response.data.choices[0].message.content;
      console.log(`Response: "${content.substring(0, 150)}..."`);
      
      // This is just informational, not a pass/fail test
      console.log('Test 5 COMPLETED - This is an informational test only');
    } catch (error) {
      console.warn('Warning: Could not test actual speaker API:', error.message);
      console.log('Test 5 SKIPPED - Could not connect to speaker API');
    }
    
    console.log('\n=== SPEAKER-EXECUTIVE INTERACTION TEST COMPLETE ===');
    return true;
  } catch (error) {
    console.error('Test failed:', error.message);
    return false;
  }
}

// Run the test
async function runTests() {
  console.log('Starting Speaker-Executive Interaction Tests...');
  
  // Test health endpoints
  try {
    const speakerHealth = await axios.get(`${API_URL}/health`);
    console.log('Speaker health check:', speakerHealth.data);
    
    const executiveHealth = await axios.get(`${EXECUTIVE_URL}/health`);
    console.log('Executive health check:', executiveHealth.data);
  } catch (error) {
    console.error('Health check failed:', error.message);
    console.log('Make sure both services are running');
    return;
  }
  
  // Run the interaction test
  await testExecutiveInteraction();
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error);
});