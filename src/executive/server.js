require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');

// Helper function to initialize chat model with provider flexibility
function initChatModel({ model, modelProvider, configurableFields, params }) {
  // Currently only supporting OpenAI, but can be extended for other providers
  return new ChatOpenAI({
    modelName: model,
    openAIApiKey: params.openAIApiKey,
    openAIApiBase: params.openAIApiBase,
    temperature: params.temperature,
    streaming: params.streaming,
    tools: params.tools
  });
}
const axios = require('axios');
const { 
  initializeNeo4jManager, 
  closeNeo4jManager,
  knowledgeTools,
  knowledgeToolSchemas
} = require('../knowledge/knowledge-tools');

const app = express();
app.use(express.json());

const PORT = process.env.EXECUTIVE_PORT || 8001;
const MODEL = process.env.EXECUTIVE_MODEL || 'gpt-4o';
const MODEL_PROVIDER = process.env.EXECUTIVE_MODEL_PROVIDER || 'openai';
const API_KEY = process.env.EXECUTIVE_API_KEY;
const API_BASE = process.env.EXECUTIVE_API_BASE;
const NEO4J_URL = process.env.NEO4J_URL || 'bolt://neo4j:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const VECTOR_STORE_URL = process.env.VECTOR_STORE_URL || 'http://vector_store:8002';

// Initialize the Neo4j manager
initializeNeo4jManager(NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD)
  .then(() => console.log('Neo4j manager initialized successfully'))
  .catch(error => console.error('Failed to initialize Neo4j manager:', error));

// Create tool definitions for the LLM
const tools = Object.entries(knowledgeToolSchemas).map(([name, schema]) => ({
  name,
  description: schema.description,
  parameters: schema.parameters
}));

// Initialize the LLM using initChatModel for provider flexibility
let llm;
try {
  llm = initChatModel({
    model: MODEL,
    modelProvider: MODEL_PROVIDER,
    configurableFields: "any",
    params: {
      openAIApiKey: API_KEY,
      openAIApiBase: API_BASE,
      temperature: 0.2, // Lower temperature for more deterministic responses
      tools: tools // Bind the knowledge tools to the LLM
    }
  });
} catch (error) {
  console.error('Error initializing LLM:', error);
  // Create a fallback LLM that just returns a default response
  llm = {
    invoke: async () => ({ content: "I'm sorry, I couldn't process your request." })
  };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Evaluation endpoint
app.post('/evaluate', async (req, res) => {
  try {
    const { original_query, messages } = req.body;

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
      evaluation = await evaluateSpeaker(original_query, messages, knowledgeDocument);
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

    // Step 4: Store the knowledge document in the vector store if it's new
    if (knowledgeDocument && knowledgeDocument.isNew) {
      try {
        await axios.post(`${VECTOR_STORE_URL}/store`, {
          text: knowledgeDocument.content,
          metadata: {
            query: original_query,
            timestamp: new Date().toISOString(),
            source: 'executive'
          }
        });
      } catch (error) {
        console.warn('Error storing in vector store:', error.message);
      }
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
 * Search the knowledge graph for information relevant to the query
 * @param {string} query - The user's query
 * @returns {Promise<Object>} - The knowledge document
 */
async function searchKnowledgeGraph(query) {
  try {
    // Extract keywords from the query (simple approach)
    const keywords = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    if (keywords.length === 0) {
      return null;
    }
    
    // Use the knowledge_search tool to find topics related to the query
    let topics = [];
    
    for (const keyword of keywords) {
      const whereClause = `t.name CONTAINS "${keyword}" OR t.description CONTAINS "${keyword}"`;
      const searchResult = await knowledgeTools.knowledge_search({
        matchClause: '(t:Topic)',
        whereClause: whereClause,
        returnClause: 't.name AS name, t.description AS description, id(t) AS id',
        params: {}
      });
      
      const results = JSON.parse(searchResult);
      
      if (results.length > 0) {
        topics = topics.concat(results.map(record => ({
          id: record.id,
          name: record.name,
          description: record.description
        })));
      }
    }
    
    // If we found topics, get related knowledge
    if (topics.length > 0) {
      const topicIds = topics.map(topic => topic.id);
      
      // Use the knowledge_search tool to find knowledge related to the topics
      const whereClause = `id(t) IN [${topicIds.join(', ')}]`;
      const searchResult = await knowledgeTools.knowledge_search({
        matchClause: '(k:Knowledge)-[:BELONGS_TO]->(t:Topic)',
        whereClause: whereClause,
        returnClause: 'k.name AS name, k.summary AS summary, k.data AS content',
        params: {}
      });
      
      const results = JSON.parse(searchResult);
      
      if (results.length > 0) {
        // Compile the knowledge into a document
        const knowledgeItems = results.map(record => ({
          name: record.name,
          summary: record.summary,
          content: record.content
        }));
        
        const document = {
          topics: topics,
          knowledge: knowledgeItems,
          content: `Knowledge related to your query:\n\n${knowledgeItems.map(item => 
            `${item.name}:\n${item.content || item.summary}`
          ).join('\n\n')}`,
          isNew: false
        };
        
        return document;
      }
    }
    
    // If we didn't find anything, return null
    return null;
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
 * @returns {Promise<Object>} - The evaluation result
 */
async function evaluateSpeaker(query, messages, knowledgeDocument) {
  try {
    // Prepare the system prompt for the executive
    const systemPrompt = `You are the Executive layer of an AI system. Your job is to evaluate if the Speaker (the user-facing AI) is on the right track and provide guidance if needed.

You have access to a knowledge graph and can provide corrections or additional information to the Speaker.

Based on the user's query and any knowledge you have, evaluate if the Speaker needs:
1. No intervention (if the Speaker is doing well)
2. An interruption (if the Speaker has made minor errors or is slightly off track)
3. A restart (if the Speaker is substantially wrong or has seriously deviated from the task)

You have access to the following tools to interact with the knowledge graph:
- knowledge_create_node: Create a node in the knowledge graph
- knowledge_create_edge: Create an edge between nodes in the knowledge graph
- knowledge_alter: Alter or delete a node in the knowledge graph
- knowledge_search: Search the knowledge graph using Cypher query components
- knowledge_unsafe_query: Execute an arbitrary Cypher query against the Neo4j knowledge graph

Use these tools to update the knowledge graph with information from the conversation.

Respond with a JSON object with the following structure:
{
  "action": "none" | "interrupt" | "restart",
  "reason": "Explanation of your decision",
  "knowledge_document": "Additional information or corrections to provide to the Speaker"
}`;

    // Prepare the user message
    let userMessage = `User Query: ${query}\n\nConversation History:\n`;
    
    // Add the conversation history
    for (const message of messages) {
      userMessage += `${message.role.toUpperCase()}: ${message.content}\n\n`;
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
      const jsonStr = jsonMatch ? jsonMatch[0] : result;
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
    
    // Check if we already have a topic for this query
    const searchResult = await knowledgeTools.knowledge_search({
      matchClause: '(t:Topic)',
      whereClause: `t.name = "${query}"`,
      returnClause: 't',
      params: {}
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
      topicId = results[0].t.id;
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
        summary: knowledgeSummary,
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