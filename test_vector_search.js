/**
 * Test script for vector search capabilities in the Executive Layer
 * 
 * This script tests:
 * 1. Creating nodes with automatic vector embedding generation
 * 2. Vector similarity search
 * 3. Hybrid search combining vector similarity with graph structure
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const EXECUTIVE_URL = process.env.EXECUTIVE_URL || 'http://localhost:8001';
const DEBUG = process.env.DEBUG === 'true';

// Test data
const testTopics = [
  { name: 'Quantum Computing', description: 'The study of computation systems that use quantum mechanics' },
  { name: 'Machine Learning', description: 'The study of computer algorithms that improve automatically through experience' },
  { name: 'Blockchain Technology', description: 'A distributed ledger technology that enables secure, transparent transactions' },
  { name: 'Artificial Intelligence', description: 'The simulation of human intelligence in machines' },
  { name: 'Neural Networks', description: 'Computing systems inspired by the biological neural networks in human brains' }
];

const testKnowledge = [
  { 
    name: 'Quantum Bits', 
    description: 'Quantum bits or qubits are the basic unit of quantum information in quantum computing',
    topic: 'Quantum Computing'
  },
  { 
    name: 'Quantum Entanglement', 
    description: 'Quantum entanglement is a physical phenomenon that occurs when a pair of particles interact in such a way that the quantum state of each particle cannot be described independently',
    topic: 'Quantum Computing'
  },
  { 
    name: 'Supervised Learning', 
    description: 'Supervised learning is a type of machine learning where the algorithm learns from labeled training data',
    topic: 'Machine Learning'
  },
  { 
    name: 'Reinforcement Learning', 
    description: 'Reinforcement learning is an area of machine learning concerned with how software agents ought to take actions in an environment to maximize some notion of cumulative reward',
    topic: 'Machine Learning'
  },
  { 
    name: 'Blockchain Consensus', 
    description: 'Consensus mechanisms are protocols that ensure all nodes in a blockchain network agree on the current state of the blockchain',
    topic: 'Blockchain Technology'
  }
];

// Test queries for vector search
const testQueries = [
  'How do quantum computers work?',
  'Explain neural networks in machine learning',
  'What is the relationship between AI and neural networks?',
  'How does blockchain ensure security?',
  'Compare supervised and reinforcement learning'
];

// Main test function
async function runTests() {
  console.log('Starting vector search capability tests...\n');
  
  try {
    // Step 1: Clear existing test data
    await clearTestData();
    
    // Step 2: Create test topics
    const topicIds = await createTestTopics();
    
    // Step 3: Create test knowledge nodes
    const knowledgeIds = await createTestKnowledge();
    
    // Step 3.5: Verify node creation and structure
    await verifyNodeCreation();
    
    // Step 4: Test vector similarity search
    await testVectorSearch();
    
    // Step 5: Test hybrid search
    await testHybridSearch();
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error.message);
    if (DEBUG) {
      console.error(error);
    }
  }
}

// Clear existing test data
async function clearTestData() {
  console.log('Clearing existing test data...');
  
  try {
    // Use a Cypher query to delete all test nodes
    const query = `
      MATCH (n)
      WHERE n.name IN [
        'Quantum Computing', 'Machine Learning', 'Blockchain Technology', 
        'Artificial Intelligence', 'Neural Networks', 'Quantum Bits',
        'Quantum Entanglement', 'Supervised Learning', 'Reinforcement Learning',
        'Blockchain Consensus'
      ]
      DETACH DELETE n
    `;
    
    await executeQuery(query);
    console.log('Existing test data cleared successfully');
  } catch (error) {
    console.warn('Warning: Could not clear test data:', error.message);
    // Continue with the test even if clearing fails
  }
}

// Create test topics
async function createTestTopics() {
  console.log('\nCreating test topics with automatic vector embeddings...');
  
  const topicIds = [];
  
  for (const topic of testTopics) {
    try {
      // Use the knowledge_create_node tool to create the topic
      // This will automatically generate and set the embedding using Hugging Face transformers
      const response = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_create_node tool to create a topic node with name "${topic.name}" and description "${topic.description}"`,
        tool_params: {
          nodeType: 'topic',
          name: topic.name,
          description: topic.description
        }
      });
      
      console.log(`Created topic: ${topic.name}`);
      
      // Extract the node ID from the response
      const idMatch = response.data.result.match(/ID: (\d+)/);
      if (idMatch) {
        topicIds.push(parseInt(idMatch[1]));
      }
    } catch (error) {
      console.error(`Error creating topic ${topic.name}:`, error.message);
      throw error;
    }
  }
  
  console.log(`Created ${topicIds.length} topics with vector embeddings`);
  return topicIds;
}

// Create test knowledge nodes
async function createTestKnowledge() {
  console.log('\nCreating test knowledge nodes with automatic vector embeddings...');
  
  const knowledgeIds = [];
  
  for (const knowledge of testKnowledge) {
    try {
      // Use the knowledge_create_node tool to create the knowledge node
      // This will automatically generate and set the embedding using Hugging Face transformers
      const response = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_create_node tool to create a knowledge node with name "${knowledge.name}" and description "${knowledge.description}" that belongs to the topic "${knowledge.topic}"`,
        tool_params: {
          nodeType: 'knowledge',
          name: knowledge.name,
          description: knowledge.description,
          belongsTo: [
            {
              type: 'topic',
              name: knowledge.topic
            }
          ]
        }
      });
      
      console.log(`Created knowledge: ${knowledge.name}`);
      
      // Extract the node ID from the response
      const idMatch = response.data.result.match(/ID: (\d+)/);
      if (idMatch) {
        knowledgeIds.push(parseInt(idMatch[1]));
      }
    } catch (error) {
      console.error(`Error creating knowledge ${knowledge.name}:`, error.message);
      throw error;
    }
  }
  
  console.log(`Created ${knowledgeIds.length} knowledge nodes with vector embeddings`);
  return knowledgeIds;
}

// Verify node creation and structure
async function verifyNodeCreation() {
  console.log('\nVerifying node creation and structure...');
  
  try {
    // Check topic nodes
    console.log('\nChecking topic nodes:');
    const topicQuery = `
      MATCH (t:Topic)
      RETURN t.name AS name, t.description AS description,
             (t.embedding IS NOT NULL) AS hasEmbedding,
             CASE WHEN t.embedding IS NOT NULL THEN size(t.embedding) ELSE null END AS embeddingSize,
             t.embedding AS embedding
    `;
    
    const topicResult = await executeQuery(topicQuery);
    console.log('Topic nodes verification result:');
    console.log(topicResult);
    
    // Check knowledge nodes
    console.log('\nChecking knowledge nodes:');
    const knowledgeQuery = `
      MATCH (k:Knowledge)
      RETURN k.name AS name, k.description AS description,
             (k.embedding IS NOT NULL) AS hasEmbedding,
             CASE WHEN k.embedding IS NOT NULL THEN size(k.embedding) ELSE null END AS embeddingSize
    `;
    
    const knowledgeResult = await executeQuery(knowledgeQuery);
    console.log('Knowledge nodes verification result:');
    console.log(knowledgeResult);
    
    // Check relationships
    console.log('\nChecking relationships:');
    const relationshipQuery = `
      MATCH (k:Knowledge)-[r:BELONGS_TO]->(t:Topic)
      RETURN k.name AS knowledge, t.name AS topic, type(r) AS relationship
    `;
    
    const relationshipResult = await executeQuery(relationshipQuery);
    console.log('Relationship verification result:');
    console.log(relationshipResult);
    
  } catch (error) {
    console.error('Error verifying node creation:', error.message);
    throw error;
  }
}

// Test vector similarity search
async function testVectorSearch() {
  console.log('\nTesting vector similarity search...');
  
  for (const query of testQueries) {
    try {
      console.log(`\nQuery: "${query}"`);
      
      // Test topic search
      const topicResponse = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_vector_search tool to find topics related to: "${query}"`,
        tool_params: {
          nodeType: 'topic',
          text: query,
          limit: 2,
          minSimilarity: 0.0  // Set to 0 to return all results regardless of similarity
        }
      });
      
      console.log('Top 2 similar topics:');
      logSearchResults(topicResponse.data.result);
      
      // Test knowledge search
      const knowledgeResponse = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_vector_search tool to find knowledge related to: "${query}"`,
        tool_params: {
          nodeType: 'knowledge',
          text: query,
          limit: 3,
          minSimilarity: 0.0  // Set to 0 to return all results regardless of similarity
        }
      });
      
      console.log('Top 3 similar knowledge items:');
      logSearchResults(knowledgeResponse.data.result);
    } catch (error) {
      console.error(`Error in vector search for query "${query}":`, error.message);
      throw error;
    }
  }
  
  console.log('\nVector similarity search tests completed successfully');
}

// Test hybrid search
async function testHybridSearch() {
  console.log('\nTesting hybrid search (combining vector similarity with graph structure)...');
  
  for (const query of testQueries) {
    try {
      console.log(`\nQuery: "${query}"`);
      
      // Test hybrid search from topic to knowledge
      const hybridResponse = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_hybrid_search tool to find topics related to "${query}" and their connected knowledge`,
        tool_params: {
          nodeType: 'topic',
          text: query,
          relationshipType: 'BELONGS_TO',  // Changed from 'contains' to 'BELONGS_TO'
          targetType: 'knowledge',
          limit: 3,
          minSimilarity: 0.0  // Set to 0 to return all results regardless of similarity
        }
      });
      
      console.log('Hybrid search results (topic → knowledge):');
      logHybridResults(hybridResponse.data.result);
    } catch (error) {
      console.error(`Error in hybrid search for query "${query}":`, error.message);
      throw error;
    }
  }
  
  console.log('\nHybrid search tests completed successfully');
}

// Helper function to execute a Cypher query
async function executeQuery(query, params = {}) {
  try {
    // Convert params to a string for logging
    const paramsStr = Object.keys(params).length > 0
      ? ` with params ${JSON.stringify(params)}`
      : '';
    
    // Use the knowledge_unsafe_query tool directly
    const response = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
      query: `Use the knowledge_unsafe_query tool to execute this Cypher query: ${query}${paramsStr}`,
      tool_params: {
        query: query,
        params: params
      }
    });
    
    return response.data.result;
  } catch (error) {
    console.error('Error executing query:', error.message);
    throw error;
  }
}

// Helper function to log search results
function logSearchResults(result) {
  try {
    // Try to extract the JSON results from the response
    const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/) || 
                      result.match(/```\n([\s\S]*?)\n```/) || 
                      result.match(/\[([\s\S]*?)\]/);
    
    if (jsonMatch) {
      const jsonResults = JSON.parse(jsonMatch[0]);
      
      if (Array.isArray(jsonResults) && jsonResults.length > 0) {
        jsonResults.forEach((item, i) => {
          console.log(`  ${i+1}. ${item.name} (Score: ${item.score.toFixed(4)})`);
          console.log(`     ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}`);
        });
      } else {
        console.log('  No results found');
      }
    } else {
      console.log('  Could not parse results');
      console.log(result);
    }
  } catch (error) {
    console.warn('Warning: Could not parse search results:', error.message);
    console.log(result);
  }
}

// Helper function to log hybrid search results
function logHybridResults(result) {
  try {
    // Try to extract the JSON results from the response
    const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/) || 
                      result.match(/```\n([\s\S]*?)\n```/) || 
                      result.match(/\[([\s\S]*?)\]/);
    
    if (jsonMatch) {
      const jsonResults = JSON.parse(jsonMatch[0]);
      
      if (Array.isArray(jsonResults) && jsonResults.length > 0) {
        jsonResults.forEach((item, i) => {
          console.log(`  ${i+1}. Topic: ${item.source.name} → Knowledge: ${item.target.name} (Score: ${item.score.toFixed(4)})`);
          console.log(`     ${item.target.description.substring(0, 100)}${item.target.description.length > 100 ? '...' : ''}`);
        });
      } else {
        console.log('  No results found');
      }
    } else {
      console.log('  Could not parse results');
      console.log(result);
    }
  } catch (error) {
    console.warn('Warning: Could not parse hybrid search results:', error.message);
    console.log(result);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('Test script failed:', error);
  process.exit(1);
});