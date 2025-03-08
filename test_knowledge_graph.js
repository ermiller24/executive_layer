import axios from 'axios';

// Configuration
const API_URL = 'http://localhost:3000';
const EXECUTIVE_URL = 'http://localhost:8001';

// Helper function to pause execution for a specified time
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Test knowledge graph tool calls via direct endpoint
async function testKnowledgeGraphDirectTools() {
  console.log('=== TESTING KNOWLEDGE GRAPH DIRECT TOOL ACCESS ===');
  
  try {
    // Step 1: Test health endpoint of the executive service
    console.log('\n1. Testing executive service health...');
    const healthResponse = await axios.get(`${EXECUTIVE_URL}/health`);
    console.log('Executive service health check:', healthResponse.data);
    
    // Step 2: Create a new test topic node
    console.log('\n2. Creating a test topic node...');
    const evaluateResponse1 = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: "Test creating a topic node",
      messages: [
        { role: 'user', content: "Create a topic node about neural networks" },
        { role: 'assistant', content: "I'll create a topic node about neural networks in the knowledge graph." }
      ]
    });
    
    console.log('Evaluation response for topic creation:');
    console.log(JSON.stringify(evaluateResponse1.data, null, 2));
    console.log('Sleeping to allow for knowledge graph operations...');
    await sleep(2000);
    
    // Step 3: Create a knowledge node for the topic
    console.log('\n3. Creating a knowledge node...');
    const evaluateResponse2 = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: "Add knowledge about neural networks",
      messages: [
        { role: 'user', content: "Please add information about neural networks being inspired by the human brain" },
        { role: 'assistant', content: "I'll add that neural networks were inspired by the structure and function of the human brain to the knowledge graph." }
      ]
    });
    
    console.log('Evaluation response for knowledge creation:');
    console.log(JSON.stringify(evaluateResponse2.data, null, 2));
    console.log('Sleeping to allow for knowledge graph operations...');
    await sleep(2000);
    
    // Step 4: Query the knowledge graph for the added information
    console.log('\n4. Querying the knowledge graph for neural networks...');
    const evaluateResponse3 = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: "What do you know about neural networks?",
      messages: [
        { role: 'user', content: "What information do you have about neural networks?" },
        { role: 'assistant', content: "Neural networks are a type of machine learning model inspired by the human brain." }
      ]
    });
    
    console.log('Evaluation response for knowledge query:');
    console.log(JSON.stringify(evaluateResponse3.data, null, 2));
    
    // Check if the response contains the information we added
    if (evaluateResponse3.data.knowledge_document && 
        evaluateResponse3.data.knowledge_document.includes('neural networks') && 
        evaluateResponse3.data.knowledge_document.includes('brain')) {
      console.log('\n✓ Successfully retrieved knowledge about neural networks from the graph!');
    } else {
      console.log('\n✗ Failed to retrieve the expected knowledge about neural networks.');
    }
    
    return true;
  } catch (error) {
    console.error('Knowledge graph direct tools test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test knowledge graph through chat completions with explicit tool calling
async function testKnowledgeGraphToolCalling() {
  console.log('\n=== TESTING KNOWLEDGE GRAPH THROUGH CHAT COMPLETIONS WITH TOOL CALLING ===');
  
  // Define the knowledge graph tools in the format expected by the chat completions API
  const knowledgeTools = [
    {
      type: 'function',
      function: {
        name: 'knowledge_create_node',
        description: 'Create a node in the knowledge graph. Node types include: tag_category, tag, topic, knowledge, file.',
        parameters: {
          type: 'object',
          properties: {
            nodeType: {
              type: 'string',
              description: 'The type of node to create (tag_category, tag, topic, knowledge, file)',
              enum: ['tag_category', 'tag', 'topic', 'knowledge', 'file']
            },
            name: {
              type: 'string',
              description: 'The name of the node (must be unique within its type)'
            },
            description: {
              type: 'string',
              description: 'A description of the node'
            },
            belongsTo: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    description: 'The type of parent node'
                  },
                  name: {
                    type: 'string',
                    description: 'The name of parent node'
                  }
                }
              },
              description: 'Optional array of nodes this node belongs to'
            }
          },
          required: ['nodeType', 'name', 'description']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'knowledge_search',
        description: 'Search the knowledge graph using flexible Cypher query components',
        parameters: {
          type: 'object',
          properties: {
            matchClause: {
              type: 'string',
              description: 'The Cypher MATCH clause specifying what to match'
            },
            whereClause: {
              type: 'string',
              description: 'Optional Cypher WHERE clause for filtering'
            },
            returnClause: {
              type: 'string',
              description: 'Optional Cypher RETURN clause specifying what to return'
            }
          },
          required: ['matchClause']
        }
      }
    }
  ];
  
  try {
    // Step 1: Create a topic about quantum computing through chat
    console.log('\n1. Creating a quantum computing topic through chat...');
    const response1 = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { 
          role: 'system', 
          content: 'You are an AI assistant with access to a knowledge graph. Use the knowledge_create_node tool to create a new topic about quantum computing.'
        },
        { 
          role: 'user', 
          content: 'Create a topic about quantum computing in the knowledge graph.'
        }
      ],
      tools: knowledgeTools,
      temperature: 0.7
    });
    
    console.log('Response for topic creation:');
    console.log(JSON.stringify(response1.data, null, 2));
    
    // Check if a tool call was made
    const hasToolCalls = response1.data.choices[0].message.tool_calls && 
                        response1.data.choices[0].message.tool_calls.length > 0;
    
    if (hasToolCalls) {
      console.log('\n✓ Successfully made tool calls to create a topic!');
      
      // Extract the first tool call
      const toolCall = response1.data.choices[0].message.tool_calls[0];
      console.log(`Tool call: ${toolCall.function.name}`);
      console.log(`Arguments: ${toolCall.function.arguments}`);
      
      // Wait for the knowledge graph to update
      console.log('Sleeping to allow for knowledge graph operations...');
      await sleep(2000);
      
      // Step 2: Search for the created topic
      console.log('\n2. Searching for the quantum computing topic...');
      const response2 = await axios.post(`${API_URL}/v1/chat/completions`, {
        model: 'eir-default',
        messages: [
          { 
            role: 'system', 
            content: 'You are an AI assistant with access to a knowledge graph. Use the knowledge_search tool to find information about quantum computing in the graph.'
          },
          { 
            role: 'user', 
            content: 'Search for information about quantum computing in the knowledge graph.'
          }
        ],
        tools: knowledgeTools,
        temperature: 0.7
      });
      
      console.log('Response for topic search:');
      console.log(JSON.stringify(response2.data, null, 2));
      
      // Check if a tool call was made for searching
      const hasSearchToolCalls = response2.data.choices[0].message.tool_calls && 
                              response2.data.choices[0].message.tool_calls.length > 0;
      
      if (hasSearchToolCalls) {
        console.log('\n✓ Successfully made tool calls to search the knowledge graph!');
      } else {
        console.log('\n✗ No tool calls were made for searching the knowledge graph.');
      }
    } else {
      console.log('\n✗ No tool calls were made for creating a topic.');
    }
    
    return hasToolCalls;
  } catch (error) {
    console.error('Knowledge graph tool calling test failed:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    return false;
  }
}

// Test knowledge graph updating from conversation
async function testKnowledgeGraphUpdate() {
  console.log('\n=== TESTING AUTOMATIC KNOWLEDGE GRAPH UPDATES FROM CONVERSATION ===');
  
  try {
    // Create a unique topic for this test
    const uniqueTopic = `Fusion Energy ${Date.now()}`;
    
    // Step 1: Have a conversation about fusion energy
    console.log(`\n1. Having a conversation about ${uniqueTopic}...`);
    const response = await axios.post(`${API_URL}/v1/chat/completions`, {
      model: 'eir-default',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant with expertise in physics and energy technologies.'
        },
        { 
          role: 'user', 
          content: `Explain what ${uniqueTopic} is and its potential benefits.`
        }
      ],
      temperature: 0.7
    });
    
    console.log('Response for fusion energy conversation:');
    console.log(`${response.data.choices[0].message.content.substring(0, 150)}...`);
    
    // Wait for the knowledge graph to update
    console.log('Sleeping to allow for knowledge graph operations...');
    await sleep(3000);
    
    // Step 2: Check if the knowledge graph was updated with the fusion energy information
    console.log('\n2. Checking if the knowledge graph was updated...');
    const evaluateResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
      original_query: `What do you know about ${uniqueTopic}?`,
      messages: [
        { role: 'user', content: `What can you tell me about ${uniqueTopic}?` },
        { role: 'assistant', content: `${uniqueTopic} is an advanced form of nuclear energy...` }
      ]
    });
    
    console.log('Evaluation response:');
    console.log(JSON.stringify(evaluateResponse.data, null, 2));
    
    // Check if the topic was added to the knowledge graph
    if (evaluateResponse.data.knowledge_document && 
        evaluateResponse.data.knowledge_document.includes(uniqueTopic)) {
      console.log(`\n✓ Successfully found the ${uniqueTopic} topic in the knowledge graph!`);
      return true;
    } else {
      console.log(`\n✗ Failed to find the ${uniqueTopic} topic in the knowledge graph.`);
      return false;
    }
  } catch (error) {
    console.error('Knowledge graph update test failed:');
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
  console.log('Starting Knowledge Graph Integration Tests...');
  
  // Test health endpoint of the API
  try {
    const healthResponse = await axios.get(`${API_URL}/health`);
    console.log('API health check:', healthResponse.data);
  } catch (error) {
    console.error('API health check failed:', error.message);
    console.log('Make sure the API server is running on', API_URL);
    return;
  }
  
  // Test health endpoint of the Executive service
  try {
    const executiveHealthResponse = await axios.get(`${EXECUTIVE_URL}/health`);
    console.log('Executive service health check:', executiveHealthResponse.data);
  } catch (error) {
    console.error('Executive service health check failed:', error.message);
    console.log('Make sure the Executive service is running on', EXECUTIVE_URL);
    return;
  }
  
  // Run the tests
  const directToolsResult = await testKnowledgeGraphDirectTools();
  const toolCallingResult = await testKnowledgeGraphToolCalling();
  const autoUpdateResult = await testKnowledgeGraphUpdate();
  
  // Print summary
  console.log('\nTest Summary:');
  console.log('Direct Knowledge Tools:', directToolsResult ? 'PASSED' : 'FAILED');
  console.log('Knowledge Tool Calling:', toolCallingResult ? 'PASSED' : 'FAILED');
  console.log('Auto Knowledge Update:', autoUpdateResult ? 'PASSED' : 'FAILED');
  
  if (directToolsResult && toolCallingResult && autoUpdateResult) {
    console.log('\nAll tests passed! The knowledge graph integration is working properly.');
    console.log('\nINSTRUCTIONS:');
    console.log('1. Look at the executive service logs for knowledge graph operations');
    console.log('2. Verify that new nodes and relationships were created for the test topics');
    console.log('3. Verify that the LLM was able to successfully use the knowledge tools');
  } else if (directToolsResult || toolCallingResult || autoUpdateResult) {
    console.log('\nSome tests passed, but others failed. The knowledge graph integration is partially working.');
    console.log('Check the logs for details on what failed and why.');
  } else {
    console.log('\nAll tests failed. The knowledge graph integration is not working properly.');
    console.log('Check the executive service and Neo4j logs for errors.');
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Error running tests:', error);
});