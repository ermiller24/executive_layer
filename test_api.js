import axios from 'axios';

// Configuration
const API_URL = 'http://localhost:3000';

// Test the chat completions endpoint
async function testChatCompletions() {
  console.log('Testing chat completions endpoint...');
  
  try {
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Tell me about quantum computing.' }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Chat completions response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('Chat completions test passed!');
    return true;
  } catch (error) {
    console.error('Chat completions test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Embeddings test removed as it requires running within the Docker container

// Test streaming chat completions
async function testStreamingChat() {
  console.log('Testing streaming chat completions...');
  
  try {
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Write a short poem about artificial intelligence.' }
      ],
      temperature: 0.7,
      stream: true
    }, {
      responseType: 'stream'
    });
    
    console.log('Streaming response:');
    
    response.data.on('data', chunk => {
      const lines = chunk.toString().split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          const data = JSON.parse(line.substring(6));
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            process.stdout.write(data.choices[0].delta.content);
          }
        }
      }
    });
    
    return new Promise(resolve => {
      response.data.on('end', () => {
        console.log('\nStreaming test passed!');
        resolve(true);
      });
      
      response.data.on('error', error => {
        console.error('\nStreaming test failed:', error);
        resolve(false);
      });
    });
  } catch (error) {
    console.error('Streaming test failed:');
    if (error.response) {
      // Don't try to stringify the response data as it may contain circular references
      console.error(error.response.status, error.response.statusText);
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test tool calling
async function testToolCalling() {
  console.log('Testing tool calling...');
  
  try {
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with access to tools.' },
        { role: 'user', content: 'What\'s the weather like in San Francisco?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather in a given location',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city and state, e.g. San Francisco, CA'
                },
                unit: {
                  type: 'string',
                  enum: ['celsius', 'fahrenheit'],
                  description: 'The temperature unit to use'
                }
              },
              required: ['location']
            }
          }
        }
      ],
      temperature: 0.7,
      stream: false
    });
    
    console.log('Tool calling response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check if tool calls are present
    if (response.data.choices[0].message.tool_calls && 
        response.data.choices[0].message.tool_calls.length > 0) {
      console.log('Tool calling test passed!');
      return true;
    } else {
      console.error('Tool calling test failed: No tool calls in response');
      return false;
    }
  } catch (error) {
    console.error('Tool calling test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test streaming tool calling
async function testStreamingToolCalling() {
  console.log('Testing streaming tool calling...');
  
  try {
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant with access to tools.' },
        { role: 'user', content: 'What\'s the weather like in New York?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather in a given location',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city and state, e.g. San Francisco, CA'
                },
                unit: {
                  type: 'string',
                  enum: ['celsius', 'fahrenheit'],
                  description: 'The temperature unit to use'
                }
              },
              required: ['location']
            }
          }
        }
      ],
      temperature: 0.7,
      stream: true
    }, {
      responseType: 'stream'
    });
    
    console.log('Streaming tool calling response:');
    
    let foundToolCalls = false;
    
    response.data.on('data', chunk => {
      const lines = chunk.toString().split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.choices && data.choices[0].delta && data.choices[0].delta.tool_calls) {
              foundToolCalls = true;
              console.log('Tool call chunk received');
            } else if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
              process.stdout.write(data.choices[0].delta.content);
            }
          } catch (e) {
            // Ignore parsing errors for incomplete chunks
          }
        }
      }
    });
    
    return new Promise(resolve => {
      response.data.on('end', () => {
        console.log('\nStreaming tool calling test:', foundToolCalls ? 'PASSED' : 'FAILED');
        resolve(foundToolCalls);
      });
      
      response.data.on('error', error => {
        console.error('\nStreaming tool calling test failed:', error);
        resolve(false);
      });
    });
  } catch (error) {
    console.error('Streaming tool calling test failed:');
    if (error.response) {
      // Don't try to stringify the response data as it may contain circular references
      console.error(error.response.status, error.response.statusText);
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test JSON mode
async function testJsonMode() {
  console.log('Testing JSON mode...');
  
  try {
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that outputs JSON.' },
        { role: 'user', content: 'Generate a JSON object with information about 3 planets in our solar system.' }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      stream: false
    });
    
    console.log('JSON mode response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check if the response is valid JSON
    try {
      const content = response.data.choices[0].message.content;
      JSON.parse(content);
      console.log('JSON mode test passed!');
      return true;
    } catch (e) {
      console.error('JSON mode test failed: Response is not valid JSON');
      return false;
    }
  } catch (error) {
    console.error('JSON mode test failed:');
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
  console.log('Starting API tests...');
  
  // Test health endpoint
  try {
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log('Health check:', healthResponse.data);
  } catch (error) {
    console.error('Health check failed:', error.message);
    console.log('Make sure the API server is running on', API_URL);
    return;
  }
  
  // Run all tests
  const chatResult = await testChatCompletions();
  const streamingResult = await testStreamingChat();
  const toolCallingResult = await testToolCalling();
  const streamingToolCallingResult = await testStreamingToolCalling();
  const jsonModeResult = await testJsonMode();
  
  // Print summary
  console.log('\nTest Summary:');
  console.log('Chat Completions:', chatResult ? 'PASSED' : 'FAILED');
  console.log('Streaming Chat:', streamingResult ? 'PASSED' : 'FAILED');
  console.log('Tool Calling:', toolCallingResult ? 'PASSED' : 'FAILED');
  console.log('Streaming Tool Calling:', streamingToolCallingResult ? 'PASSED' : 'FAILED');
  console.log('JSON Mode:', jsonModeResult ? 'PASSED' : 'FAILED');
  console.log('Embeddings: SKIPPED (requires Docker container)');
  
  const allPassed = chatResult && streamingResult &&
                    toolCallingResult && streamingToolCallingResult && jsonModeResult;
  const basicPassed = chatResult;
  
  if (allPassed) {
    console.log('\nAll tests passed! The API is fully working.');
  } else if (basicPassed) {
    console.log('\nBasic tests passed, but some advanced features failed. Check the logs for details.');
  } else {
    console.log('\nSome basic tests failed. Check the logs for details.');
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error);
});