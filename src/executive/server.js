import dotenv from 'dotenv';
import express from 'express';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { initChatModel } from "langchain/chat_models/universal";

import axios from 'axios';
import {
  initializeNeo4jManager,
  closeNeo4jManager,
  knowledgeTools,
  knowledgeToolSchemas
} from '../knowledge/knowledge-tools.js';

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.EXECUTIVE_PORT || 8001;
const MODEL = process.env.EXECUTIVE_MODEL || 'openai:gpt-4o';
const MODEL_KWARGS = process.env.EXECUTIVE_MODEL_KWARGS ? JSON.parse(process.env.EXECUTIVE_MODEL_KWARGS) : {};
const NEO4J_URL = process.env.NEO4J_URL || 'bolt://neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = parseInt(process.env.EMBEDDING_DIMENSION || '384');

// Initialize the Neo4j manager with embedding model parameters
initializeNeo4jManager(NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD, EMBEDDING_MODEL, EMBEDDING_DIMENSION)
  .then(() => console.log('Neo4j manager initialized successfully'))
  .catch(error => console.error('Failed to initialize Neo4j manager:', error));

// Create tool definitions for the LLM
const tools = Object.entries(knowledgeToolSchemas).map(([name, schema]) => ({
  name,
  description: schema.description,
  parameters: schema.parameters
}));

// Initialize the LLM using initChatModel for provider flexibility
const unbound_llm = await initChatModel(
  MODEL,
  MODEL_KWARGS
);
const llm = unbound_llm.bind(tools);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Debug endpoint - only accessible when debug mode is enabled
const DEBUG = process.env.DEBUG === 'true';
if (DEBUG) {
  app.post('/debug/query', async (req, res) => {
    try {
      const { query, tool_params } = req.body;
      
      if (!query) {
        return res.status(400).json({
          error: {
            message: 'Query is required',
            type: 'invalid_request_error'
          }
        });
      }
      
      // If tool_params is provided, directly call the appropriate knowledge tool
      if (tool_params) {
        console.log(`[DEBUG] Direct tool call with params:`, tool_params);
        
        // Try to determine the tool name from the query or tool_params
        let toolName = null;
        
        // First, check if the query explicitly mentions a knowledge tool
        const toolNameMatch = query.match(/knowledge_(\w+)/);
        if (toolNameMatch) {
          toolName = `knowledge_${toolNameMatch[1]}`;
        } 
        // If not, try to infer the tool from tool_params
        else if (tool_params.query) {
          // If tool_params has a query parameter, it's likely knowledge_unsafe_query
          toolName = 'knowledge_unsafe_query';
        } 
        else if (tool_params.nodeType) {
          // If tool_params has a nodeType parameter, determine the appropriate tool
          if (tool_params.text && tool_params.relationshipType && tool_params.targetType) {
            // If it has text, relationshipType, and targetType, it's likely knowledge_hybrid_search
            toolName = 'knowledge_hybrid_search';
          } 
          else if (tool_params.text) {
            // If it has text but no relationshipType, it's likely knowledge_vector_search
            toolName = 'knowledge_vector_search';
          } 
          else if (tool_params.belongsTo) {
            // If it has belongsTo, it's likely knowledge_create_node
            toolName = 'knowledge_create_node';
          } 
          else {
            // Default to knowledge_create_node for nodeType
            toolName = 'knowledge_create_node';
          }
        }
        
        // Check if the tool exists
        if (toolName && knowledgeTools[toolName]) {
          try {
            // Call the tool with the provided parameters
            console.log(`[DEBUG] Calling tool ${toolName}`);
            const result = await knowledgeTools[toolName](tool_params);
            return res.json({ result });
          } catch (toolError) {
            console.error(`[DEBUG] Error calling tool ${toolName}:`, toolError);
            return res.status(500).json({
              error: {
                message: `Error calling tool ${toolName}: ${toolError.message}`,
                type: 'tool_error'
              }
            });
          }
        } else {
          console.log(`[DEBUG] No matching tool found for params:`, tool_params);
        }
        
        // If we couldn't determine a tool or the tool doesn't exist, fall back to LLM
        console.log(`[DEBUG] No matching tool found, falling back to LLM`);
      }
      
      // Create a system prompt for direct querying
      const systemPrompt = `You are the Executive layer of an AI system. You have access to a knowledge graph and can use tools to interact with it.
      
You have access to the following tools to interact with the knowledge graph:
- knowledge_create_node: Create a node in the knowledge graph
- knowledge_create_edge: Create an edge between nodes in the knowledge graph
- knowledge_alter: Alter or delete a node in the knowledge graph
- knowledge_search: Search the knowledge graph using Cypher query components
- knowledge_unsafe_query: Execute an arbitrary Cypher query against the Neo4j knowledge graph
- knowledge_vector_search: Search for nodes similar to a text query using vector similarity
- knowledge_hybrid_search: Perform a hybrid search combining vector similarity with graph structure

Respond to the user's query using these tools as needed.`;
      
      // Create a runnable sequence
      const chain = RunnableSequence.from([
        llm,
        new StringOutputParser()
      ]);
      
      // Invoke the chain
      const result = await chain.invoke([
        { type: 'system', content: systemPrompt },
        { type: 'human', content: query }
      ]);
      
      res.json({ result });
    } catch (error) {
      console.error('Error in debug query:', error);
      res.status(500).json({
        error: {
          message: 'An error occurred during debug query',
          type: 'server_error'
        }
      });
    }
  });
}

// Evaluation endpoint
app.post('/evaluate', async (req, res) => {
  try {
    const { original_query, messages, speaker_output } = req.body;

    if (!original_query || !messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'Invalid request parameters',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_request'
        }
      });
    }
    
    // Log if we received speaker output
    if (speaker_output) {
      console.log(`[EVALUATE] Received speaker output (${speaker_output.length} chars) for evaluation`);
    }

    // Step 1: Search the knowledge graph for relevant information
    let knowledgeDocument;
    try {
      knowledgeDocument = await searchKnowledgeGraph(original_query);
    } catch (error) {
      console.error('Error searching knowledge graph:', error);
      knowledgeDocument = null;
    }

    // Step 2: Evaluate if the speaker is on the right track
    let evaluation;
    try {
      evaluation = await evaluateSpeaker(original_query, messages, knowledgeDocument, speaker_output);
    } catch (error) {
      console.error('Error evaluating speaker:', error);
      evaluation = {
        action: 'none',
        reason: 'Error during evaluation',
        knowledge_document: knowledgeDocument ? knowledgeDocument.content : 'No additional information'
      };
    }

    // Step 3: Update the knowledge graph based on the conversation
    try {
      await updateKnowledgeGraph(original_query, messages, knowledgeDocument);
    } catch (error) {
      console.error('Error updating knowledge graph:', error);
      // Continue even if updating the knowledge graph fails
    }

    // Return the evaluation result
    res.json(evaluation);
  } catch (error) {
    console.error('Error in evaluation:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during evaluation',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
});

/**
 * Search the knowledge graph for information relevant to the query using vector similarity
 * @param {string} query - The user's query
 * @returns {Promise<Object>} - The knowledge document
 */
async function searchKnowledgeGraph(query) {
  try {
    // Use vector search to find topics related to the query
    const topicSearchResult = await knowledgeTools.knowledge_vector_search({
      nodeType: 'topic',
      text: query,
      limit: 5,
      minSimilarity: 0.6
    });
    
    const topicResults = JSON.parse(topicSearchResult);
    
    if (topicResults.length === 0) {
      // If no topics found, try a more general search across all node types
      const generalSearchResult = await knowledgeTools.knowledge_vector_search({
        nodeType: 'knowledge',
        text: query,
        limit: 5,
        minSimilarity: 0.5
      });
      
      const generalResults = JSON.parse(generalSearchResult);
      
      if (generalResults.length > 0) {
        // Compile the knowledge into a document
        const knowledgeItems = generalResults.map(record => ({
          name: record.name,
          description: record.description,
          score: record.score
        }));
        
        const document = {
          topics: [],
          knowledge: knowledgeItems,
          content: `Knowledge related to your query:\n\n${knowledgeItems.map(item => 
            `${item.name} (similarity: ${item.score.toFixed(2)}):\n${item.description}`
          ).join('\n\n')}`,
          isNew: false
        };
        
        return document;
      }
      
      return null;
    }
    
    // We found topics, now get related knowledge using hybrid search
    const topics = topicResults.map(record => ({
      id: record.id,
      name: record.name,
      description: record.description,
      score: record.score
    }));
    
    // For each topic, find related knowledge
    let allKnowledgeItems = [];
    
    for (const topic of topics) {
      try {
        // Use hybrid search to find knowledge related to the topic
        const hybridSearchResult = await knowledgeTools.knowledge_hybrid_search({
          nodeType: 'topic',
          text: topic.name,
          relationshipType: 'BELONGS_TO',  // Updated to match the actual relationship type
          targetType: 'knowledge',
          limit: 5,
          minSimilarity: 0.6
        });
        
        const hybridResults = JSON.parse(hybridSearchResult);
        
        if (hybridResults.length > 0) {
          // Add the knowledge items to our collection
          const knowledgeItems = hybridResults.map(record => ({
            name: record.target.name,
            description: record.target.description,
            score: record.score,
            topicName: topic.name,
            topicScore: topic.score
          }));
          
          allKnowledgeItems = allKnowledgeItems.concat(knowledgeItems);
        }
      } catch (error) {
        console.error(`Error in hybrid search for topic ${topic.name}:`, error);
        // Continue with other topics
      }
    }
    
    // If we found knowledge items, compile them into a document
    if (allKnowledgeItems.length > 0) {
      // Sort by score (descending)
      allKnowledgeItems.sort((a, b) => b.score - a.score);
      
      const document = {
        topics: topics,
        knowledge: allKnowledgeItems,
        content: `Knowledge related to your query:\n\n${allKnowledgeItems.map(item => 
          `${item.name} (from topic: ${item.topicName}, similarity: ${item.score.toFixed(2)}):\n${item.description}`
        ).join('\n\n')}`,
        isNew: false
      };
      
      return document;
    }
    
    // If we found topics but no knowledge, create a document with just the topics
    const document = {
      topics: topics,
      knowledge: [],
      content: `Topics related to your query:\n\n${topics.map(topic => 
        `${topic.name} (similarity: ${topic.score.toFixed(2)}):\n${topic.description}`
      ).join('\n\n')}`,
      isNew: false
    };
    
    return document;
  } catch (error) {
    console.error('Error searching knowledge graph:', error);
    return null;
  }
}

/**
 * Evaluate if the speaker is on the right track
 * @param {string} query - The user's query
 * @param {Array} messages - The conversation messages
 * @param {Object} knowledgeDocument - The knowledge document
 * @param {string} speakerOutput - The current output from the speaker (if available)
 * @returns {Promise<Object>} - The evaluation result
 */
async function evaluateSpeaker(query, messages, knowledgeDocument, speakerOutput) {
  try {
    // Prepare the system prompt for the executive
    const systemPrompt = `You are the Executive layer of an AI system. Your job is to evaluate if the Speaker (the user-facing AI) is on the right track and provide guidance if needed.

You have access to a knowledge graph and can provide corrections or additional information to the Speaker.

Based on the user's query, the Speaker's output, and any knowledge you have, evaluate if the Speaker needs:
1. No intervention (if the Speaker is doing well)
2. An interruption (if the Speaker has made minor errors or is slightly off track)

You should be more likely to intervene if:
- The Speaker contradicts information in the knowledge graph
- The Speaker provides factually incorrect information
- The Speaker misunderstands the user's query
- The Speaker goes off-topic or fails to address the user's needs

You have access to the following tools to interact with the knowledge graph:
- knowledge_create_node: Create a node in the knowledge graph
- knowledge_create_edge: Create an edge between nodes in the knowledge graph
- knowledge_alter: Alter or delete a node in the knowledge graph
- knowledge_search: Search the knowledge graph using Cypher query components
- knowledge_unsafe_query: Execute an arbitrary Cypher query against the Neo4j knowledge graph
- knowledge_vector_search: Search for nodes similar to a text query using vector similarity
- knowledge_hybrid_search: Perform a hybrid search combining vector similarity with graph structure

Use these tools to update the knowledge graph with information from the conversation.

Respond with a JSON object with the following structure:
{
  "action": "none" | "interrupt",
  "reason": "Explanation of your decision",
  "knowledge_document": "Additional information or corrections to provide to the Speaker"
}`;

    // Prepare the user message
    let userMessage = `User Query: ${query}\n\nConversation History:\n`;
    
    // Add the conversation history
    for (const message of messages) {
      userMessage += `${message.role.toUpperCase()}: ${message.content}\n\n`;
    }
    
    // Add the speaker's output if available
    if (speakerOutput) {
      userMessage += `\nCurrent Speaker Output:\n${speakerOutput}\n\n`;
    }
    
    // Add the knowledge document if available
    if (knowledgeDocument) {
      userMessage += `\nRelevant Knowledge:\n${knowledgeDocument.content}\n\n`;
    } else {
      userMessage += `\nNo relevant knowledge found in the knowledge graph.\n\n`;
    }
    
    userMessage += `Evaluate if the Speaker needs intervention, and if so, what kind. Also, update the knowledge graph with any new information from this conversation.`;

    // Create a runnable sequence
    const chain = RunnableSequence.from([
      llm,
      new StringOutputParser()
    ]);

    // Invoke the chain
    const result = await chain.invoke([
      { type: 'system', content: systemPrompt },
      { type: 'human', content: userMessage }
    ]);

    // Parse the result
    try {
      // Extract JSON from the result (it might be wrapped in markdown code blocks)
      const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/) || result.match(/```\n([\s\S]*?)\n```/) || result.match(/{[\s\S]*?}/);
      
      // If we matched a code block, extract the content inside the block (group 1)
      // Otherwise, use the entire match or fall back to the original result
      const jsonStr = jsonMatch
        ? (jsonMatch[1] !== undefined ? jsonMatch[1] : jsonMatch[0])
        : result;
      
      console.log('Parsing JSON string:', jsonStr.substring(0, 100) + (jsonStr.length > 100 ? '...' : ''));
      const evaluation = JSON.parse(jsonStr);
      
      // Ensure the evaluation has the required fields
      if (!evaluation.action) {
        evaluation.action = 'none';
      }
      
      if (!evaluation.reason) {
        evaluation.reason = 'No reason provided';
      }
      
      if (!evaluation.knowledge_document) {
        evaluation.knowledge_document = knowledgeDocument ? knowledgeDocument.content : 'No additional information';
      }
      
      return evaluation;
    } catch (error) {
      console.error('Error parsing evaluation result:', error);
      
      // Return a default evaluation
      return {
        action: 'none',
        reason: 'Failed to parse evaluation result',
        knowledge_document: knowledgeDocument ? knowledgeDocument.content : 'No additional information'
      };
    }
  } catch (error) {
    console.error('Error evaluating speaker:', error);
    
    // Return a default evaluation
    return {
      action: 'none',
      reason: 'Error during evaluation',
      knowledge_document: knowledgeDocument ? knowledgeDocument.content : 'No additional information'
    };
  }
}

/**
 * Update the knowledge graph based on the conversation
 * @param {string} query - The user's query
 * @param {Array} messages - The conversation messages
 * @param {Object} knowledgeDocument - The knowledge document
 * @returns {Promise<void>}
 */
async function updateKnowledgeGraph(query, messages, knowledgeDocument) {
  try {
    // Extract the last user message and assistant response
    const userMessage = messages.find(msg => msg.role === 'user');
    const assistantMessage = messages.find(msg => msg.role === 'assistant');
    
    if (!userMessage || !assistantMessage) {
      return;
    }
    
    // Check if we already have a topic for this query using vector search
    const searchResult = await knowledgeTools.knowledge_vector_search({
      nodeType: 'topic',
      text: query,
      limit: 1,
      minSimilarity: 0.9  // High similarity threshold for exact matches
    });
    
    const results = JSON.parse(searchResult);
    let topicId;
    
    if (results.length === 0) {
      // Create a new topic
      const createResult = await knowledgeTools.knowledge_create_node({
        nodeType: 'topic',
        name: query,
        description: `Topic based on user query: ${query}`
      });
      
      // Extract the node ID from the result message
      const idMatch = createResult.match(/ID: (\d+)/);
      topicId = idMatch ? parseInt(idMatch[1]) : null;
    } else {
      topicId = results[0].id;
    }
    
    if (topicId) {
      // Create a knowledge node with the conversation
      const knowledgeName = `Conversation about: ${query}`;
      const knowledgeSummary = `User asked: ${userMessage.content.substring(0, 100)}...`;
      const knowledgeData = `User: ${userMessage.content}\n\nAssistant: ${assistantMessage.content}`;
      
      await knowledgeTools.knowledge_create_node({
        nodeType: 'knowledge',
        name: knowledgeName,
        description: knowledgeData,
        additionalFields: {
          summary: knowledgeSummary,
          data: knowledgeData
        },
        belongsTo: [
          {
            type: 'topic',
            name: query
          }
        ]
      });
    }
  } catch (error) {
    console.error('Error updating knowledge graph:', error);
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`Executive LLM service running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await closeNeo4jManager();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await closeNeo4jManager();
  process.exit(0);
});