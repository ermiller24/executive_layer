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
      
      // Create a system prompt for direct querying
      const systemPrompt = `You are the Executive layer of an AI system. You have access to a knowledge graph and can use tools to interact with it.
      
You have access to the following tools to interact with the knowledge graph:
- knowledge_create_node: Create a node in the knowledge graph
- knowledge_create_edge: Create an edge between nodes in the knowledge graph
- knowledge_alter: Alter or delete a node in the knowledge graph
- knowledge_search: Search the knowledge graph using Cypher query components
- knowledge_unsafe_query: Execute an arbitrary Cypher query against the Neo4j knowledge graph

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

// The update_evaluation endpoint has been removed as it was only used for logging
// and didn't provide significant value to the system.
// The executive now only receives updates through the main /evaluate endpoint.

// Response plan endpoint for extended mode
app.post('/generate_response_plan', async (req, res) => {
  try {
    console.log('[EXECUTIVE] Received request to generate response plan');
    const { query, messages } = req.body;

    console.log(`[EXECUTIVE] Query: ${query.substring(0, 50)}...`);
    console.log(`[EXECUTIVE] Messages count: ${messages ? messages.length : 0}`);

    if (!query || !messages || !Array.isArray(messages)) {
      console.error('[EXECUTIVE] Invalid request parameters for response plan generation');
      return res.status(400).json({
        error: {
          message: 'Invalid request parameters',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_request'
        }
      });
    }

    // Generate a response plan
    console.log('[EXECUTIVE] Generating response plan...');
    const responsePlan = await generateResponsePlan(query, messages);
    console.log(`[EXECUTIVE] Response plan generated (${responsePlan.length} chars)`);

    // Return the response plan
    res.json({ response_plan: responsePlan });
    console.log('[EXECUTIVE] Response plan sent successfully');
  } catch (error) {
    console.error('[EXECUTIVE] Error generating response plan:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during response plan generation',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
});

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

    // The executive no longer stores documents in the vector store
    // The speaker is the sole owner of the vector store

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
3. A restart (if the Speaker is substantially wrong or has seriously deviated from the task)

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
 * Generate a response plan for a query
 * @param {string} query - The user's query
 * @param {Array} messages - The conversation messages
 * @returns {Promise<string>} - The generated response plan
 */
async function generateResponsePlan(query, messages) {
  try {
    console.log('[EXECUTIVE] generateResponsePlan called');
    console.log(`[EXECUTIVE] Query: ${query}`);
    console.log(`[EXECUTIVE] Messages count: ${messages.length}`);
    
    // Search the knowledge graph for relevant information
    let knowledgeDocument;
    try {
      console.log('[EXECUTIVE] Searching knowledge graph for response plan');
      knowledgeDocument = await searchKnowledgeGraph(query);
      console.log('[EXECUTIVE] Knowledge graph search completed');
      if (knowledgeDocument) {
        console.log('[EXECUTIVE] Knowledge document found');
      } else {
        console.log('[EXECUTIVE] No knowledge document found');
      }
    } catch (error) {
      console.error('[EXECUTIVE] Error searching knowledge graph for response plan:', error);
      knowledgeDocument = null;
    }

    // Prepare the system prompt for the executive
    console.log('[EXECUTIVE] Preparing system prompt');
    const systemPrompt = `You are the Executive layer of an AI system. Your job is to create a detailed, structured response plan for the Speaker (the user-facing AI) to follow when responding to the user's query.

This is for Extended Response Mode, where you (the Executive) create a comprehensive plan BEFORE the Speaker begins responding. The Speaker will follow your plan step by step.

The response plan should:
1. Break down the query into its key components and objectives
2. Outline the main points that should be covered in the response, in a logical sequence
3. Provide a clear, step-by-step structure for the response (numbered sections and subsections)
4. Specify what research or knowledge is needed for each section
5. Identify any potential challenges or areas where the Speaker might need additional information
6. Provide guidance on tone, style, and level of detail appropriate for this query
7. Include specific instructions for complex parts of the response
8. Suggest examples, analogies, or illustrations where appropriate

Format your response plan as a structured Markdown document with:
- A title that reflects the user's query
- Clear section headings and subheadings
- Numbered steps or bullet points for clarity
- Specific instructions for the Speaker at each step

This response plan will be used to guide the Speaker's response and will be stored in a progress document for reference during extended conversations. Be thorough and specific, as this plan will help maintain coherence in long conversations.

You have access to the following tools to interact with the knowledge graph:
- knowledge_create_node: Create a node in the knowledge graph
- knowledge_create_edge: Create an edge between nodes in the knowledge graph
- knowledge_alter: Alter or delete a node in the knowledge graph
- knowledge_search: Search the knowledge graph using Cypher query components
- knowledge_unsafe_query: Execute an arbitrary Cypher query against the Neo4j knowledge graph

Use these tools to gather information from the knowledge graph if needed.`;

    // Prepare the user message
    console.log('[EXECUTIVE] Preparing user message');
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
    
    userMessage += `Create a detailed, structured response plan for addressing this query. Remember, you are creating a plan for the Speaker to follow, not writing the actual response. Be specific and thorough, as this plan will guide the Speaker's response and help maintain coherence in long conversations.`;

    // Create a runnable sequence
    console.log('[EXECUTIVE] Creating runnable sequence');
    const chain = RunnableSequence.from([
      llm,
      new StringOutputParser()
    ]);

    // Invoke the chain
    console.log('[EXECUTIVE] Invoking LLM chain');
    const result = await chain.invoke([
      { type: 'system', content: systemPrompt },
      { type: 'human', content: userMessage }
    ]);
    console.log(`[EXECUTIVE] LLM chain result received (${result.length} chars)`);
    console.log(`[EXECUTIVE] Result preview: ${result.substring(0, 100)}...`);

    return result;
  } catch (error) {
    console.error('[EXECUTIVE] Error generating response plan:', error);
    return `Error generating response plan: ${error.message}. Proceeding with default response.`;
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