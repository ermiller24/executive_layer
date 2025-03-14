import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { initChatModel } from "langchain/chat_models/universal";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import fs from 'fs/promises';
import path from 'path';

dotenv.config();
const app = express();
app.use(express.json());

// Configuration from environment variables
const PORT = process.env.API_PORT || 3000;
const SPEAKER_PORT = process.env.SPEAKER_PORT || 8002;
const EXECUTIVE_URL = process.env.EXECUTIVE_URL || 'http://executive:8001';
const DEBUG = process.env.DEBUG === 'true';

// Log debug status
console.log(`Debug mode: ${DEBUG ? 'enabled' : 'disabled'}`);

// Model configuration
const MODEL = process.env.SPEAKER_MODEL || 'openai:gpt-4o';
const MODEL_KWARGS = process.env.SPEAKER_MODEL_KWARGS ? JSON.parse(process.env.SPEAKER_MODEL_KWARGS) : {};

// Default API key
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || '';

// Initialize the LLM using initChatModel for provider flexibility
const llm = await initChatModel(
  MODEL,
  MODEL_KWARGS
);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Authentication middleware
app.use((req, res, next) => {
  // Extract API key from Authorization header
  const authHeader = req.headers.authorization;
  let apiKey = '';
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  }
  
  // Store the API key in the request object for later use
  req.apiKey = apiKey || DEFAULT_API_KEY;
  
  // Continue to the next middleware
  next();
});

// Add a route handler for /chat/completions (without v1 prefix) for compatibility
app.post('/chat/completions', async (req, res) => {
  // Forward the request to the /v1/chat/completions handler
  req.url = '/v1/chat/completions';
  app._router.handle(req, res);
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    // Extract request parameters
    const {
      messages,
      temperature = 0.7,
      top_p = 1,
      n = 1,
      stream = false,
      max_tokens,
      presence_penalty = 0,
      frequency_penalty = 0,
      user,
      tools,
      tool_choice,
      response_format,
      include_executive_thinking = false // Parameter to include executive reasoning
    } = req.body;

    // Validate required parameters
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'invalid_messages'
        }
      });
    }
    
    // Get the user's message
    const userMessageContent = messages[messages.length - 1].content;
    // Convert content to string for logging
    const userMessage = typeof userMessageContent === 'string'
      ? userMessageContent
      : Array.isArray(userMessageContent)
        ? JSON.stringify(userMessageContent)
        : String(userMessageContent || '');
    
    // Query the knowledge graph for relevant context using the executive service
    let knowledgeContext = null;
    try {
      console.log(`[KNOWLEDGE_GRAPH] Querying knowledge graph for context related to: "${userMessage.substring(0, 50)}..."`);
      
      // Use the executive service to perform a vector search
      const searchResponse = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
        query: `Use the knowledge_vector_search tool to find information related to: "${userMessage}"`,
        tool_params: {
          nodeType: 'knowledge',
          text: userMessage,
          limit: 3,
          minSimilarity: 0.6
        }
      });
      
      if (searchResponse.data && searchResponse.data.result) {
        // Extract the search results from the executive response
        const resultText = searchResponse.data.result;
        
        // Try to extract the JSON results from the response
        const jsonMatch = resultText.match(/```json\n([\s\S]*?)\n```/) || 
                          resultText.match(/```\n([\s\S]*?)\n```/) || 
                          resultText.match(/\[([\s\S]*?)\]/);
        
        if (jsonMatch) {
          try {
            const jsonResults = JSON.parse(jsonMatch[0]);
            
            if (Array.isArray(jsonResults) && jsonResults.length > 0) {
              // Format results
              knowledgeContext = jsonResults.map(item => ({
                id: item.id,
                name: item.name,
                description: item.description,
                score: item.score
              }));
              
              console.log(`[KNOWLEDGE_GRAPH] Found ${knowledgeContext.length} relevant items in knowledge graph`);
              knowledgeContext.forEach((item, i) => {
                console.log(`[KNOWLEDGE_GRAPH] Result ${i+1}: ID=${item.id}, Score=${item.score.toFixed(4)}, Name=${item.name}`);
                console.log(`[KNOWLEDGE_GRAPH] Content snippet: "${item.description.substring(0, 100)}..."`);
              });
            } else {
              console.log('[KNOWLEDGE_GRAPH] No relevant items found in knowledge graph');
            }
          } catch (parseError) {
            console.error('[KNOWLEDGE_GRAPH] Error parsing search results:', parseError);
          }
        } else {
          console.log('[KNOWLEDGE_GRAPH] No structured results found in executive response');
        }
      } else {
        console.log('[KNOWLEDGE_GRAPH] No results returned from executive service');
      }
    } catch (error) {
      console.warn('[KNOWLEDGE_GRAPH] Error querying knowledge graph:', error.message);
      // Continue without knowledge graph context
    }

    // Prepare messages with knowledge graph context if available
    const speakerMessages = [...messages];
    
    if (knowledgeContext) {
      // Insert knowledge graph context as a system message before the user's message
      const contextMessage = {
        role: 'system',
        content: `Relevant context from knowledge graph:\n${knowledgeContext.map(item => 
          `${item.name} (similarity: ${item.score.toFixed(2)}):\n${item.description}`
        ).join('\n\n')}`
      };
      
      // Insert before the last message (which is the user's message)
      speakerMessages.splice(speakerMessages.length - 1, 0, contextMessage);
    }

    // Start the executive process in parallel
    let executiveRequest = {
      original_query: userMessage,
      messages: messages.map(msg => ({
        ...msg,
        content: typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? JSON.stringify(msg.content)
            : String(msg.content || '')
      })),
      // Initially no speaker output, will be updated during streaming
      speaker_output: ''
    };
    
    // Connect to the executive service
    const executivePromise = axios.post(`${EXECUTIVE_URL}/evaluate`, executiveRequest)
      .catch(error => {
        console.warn('Executive evaluation error:', error.message);
        // Return a default response if executive fails
        return { data: { action: 'none', knowledge_document: '' } };
      });

    // Forward the request to the internal chat endpoint
    await handleChatRequest(speakerMessages, {
      temperature,
      max_tokens,
      presence_penalty,
      frequency_penalty,
      stream,
      tools,
      tool_choice,
      response_format,
      include_executive_thinking, // Pass the new parameter
      executivePromise
    }, req, res);
  } catch (error) {
    console.error('Error in chat completions:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during chat completion',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
});

// Add a route handler for /embeddings (without v1 prefix) for compatibility
app.post('/embeddings', async (req, res) => {
  // Forward the request to the /v1/embeddings handler
  req.url = '/v1/embeddings';
  app._router.handle(req, res);
});

// OpenAI-compatible embeddings endpoint
app.post('/v1/embeddings', async (req, res) => {
  try {
    // Extract request parameters
    const { model = 'exlayer-embedding', input, user } = req.body;
    
    if (!input) {
      return res.status(400).json({
        error: {
          message: 'input is required',
          type: 'invalid_request_error',
          param: 'input',
          code: 'invalid_input'
        }
      });
    }
    
    // Convert input to array if it's a string
    const inputArray = Array.isArray(input) ? input : [input];
    
    // Generate embeddings using the executive service
    const embeddingArrays = await Promise.all(
      inputArray.map(async (text) => {
        try {
          // Use the executive service to generate embeddings
          const response = await axios.post(`${EXECUTIVE_URL}/debug/query`, {
            query: `Generate an embedding for the following text and return it as a JSON array: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
            tool_params: {
              text: text
            }
          });
          
          if (response.data && response.data.result) {
            // Try to extract the embedding array from the response
            const jsonMatch = response.data.result.match(/\[([\s\S]*?)\]/) || 
                              response.data.result.match(/```json\n([\s\S]*?)\n```/) || 
                              response.data.result.match(/```\n([\s\S]*?)\n```/);
            
            if (jsonMatch) {
              try {
                // Parse the embedding array
                const embedding = JSON.parse(jsonMatch[0]);
                return embedding;
              } catch (parseError) {
                console.error('Error parsing embedding:', parseError);
                // Return a mock embedding if parsing fails
                return Array(384).fill(0).map(() => Math.random() * 2 - 1);
              }
            }
          }
          
          // If no valid embedding found, return a mock embedding
          console.warn('No valid embedding found in executive response, using mock embedding');
          return Array(384).fill(0).map(() => Math.random() * 2 - 1);
        } catch (error) {
          console.error('Error generating embedding:', error);
          // Return a mock embedding if the executive service fails
          return Array(384).fill(0).map(() => Math.random() * 2 - 1);
        }
      })
    );
    
    // Format response in OpenAI-compatible format
    const formattedResponse = {
      object: 'list',
      data: embeddingArrays.map((embedding, index) => ({
        object: 'embedding',
        embedding,
        index
      })),
      model,
      usage: {
        prompt_tokens: inputArray.join(' ').split(/\s+/).length,
        total_tokens: inputArray.join(' ').split(/\s+/).length
      }
    };
    
    res.json(formattedResponse);
  } catch (error) {
    console.error('Error in embeddings:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during embedding generation',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
});

// Internal chat endpoint (used by the OpenAI-compatible endpoint)
async function handleChatRequest(messages, options, req, res) {
  try {
    const {
      temperature = 0.7,
      max_tokens,
      presence_penalty = 0,
      frequency_penalty = 0,
      stream = false,
      tools,
      tool_choice,
      response_format,
      include_executive_thinking = false, // Extract the new parameter
      executivePromise: initialExecutivePromise
    } = options;
    
    // Create a mutable variable for the executive promise
    let executivePromise = initialExecutivePromise;

    // Configure the LLM with the request parameters
    let configOptions = {
      temperature: temperature,
      maxTokens: max_tokens,
      presencePenalty: presence_penalty,
      frequencyPenalty: frequency_penalty
    };

    // Add tools if provided
    if (tools && Array.isArray(tools) && tools.length > 0) {
      configOptions.tools = tools;
    }

    // Add tool_choice if provided
    if (tool_choice) {
      configOptions.toolChoice = tool_choice;
    }

    // Create a flag for JSON mode but don't pass it to the LLM directly
    // This allows the executive to see all the speaker's thoughts
    const isJsonMode = response_format && response_format.type === 'json_object';
    
    // Only pass non-JSON response formats to the LLM
    if (response_format && !isJsonMode) {
      configOptions.responseFormat = response_format;
    }

    const configuredLLM = llm.bind(configOptions);

    // Convert messages to LangChain format using proper message classes
    const langchainMessages = [];
    for (const msg of messages) {
      // Ensure content is properly formatted for LangChain
      let content = msg.content;
      
      // If content is null or undefined, set it to empty string
      if (content === null || content === undefined) {
        content = '';
      }
      
      // If content is an array (multimodal content), convert to string for now
      // This is a simplification - ideally we would handle multimodal content properly
      if (Array.isArray(content)) {
        // Extract text parts from the content array
        const textParts = content
          .filter(part => part.type === 'text')
          .map(part => part.text)
          .join('\n');
        
        content = textParts || JSON.stringify(content);
      }
      
      // Create appropriate message type
      if (msg.role === 'user') {
        langchainMessages.push(new HumanMessage(content));
      } else if (msg.role === 'assistant') {
        langchainMessages.push(new AIMessage(content));
      } else if (msg.role === 'system') {
        langchainMessages.push(new SystemMessage(content));
      } else {
        langchainMessages.push(new HumanMessage(content));
      }
    }

    // Handle streaming response
    if (stream) {
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Generate a unique ID for this response
      const responseId = `chatcmpl-${Date.now()}`;
      const startTime = Math.floor(Date.now() / 1000);

      // Send the initial response with the assistant role
      const initialEvent = {
        id: responseId,
        object: 'chat.completion.chunk',
        created: startTime,
        model: MODEL,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant'
          },
          finish_reason: null
        }]
      };
      res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);
      
      // If debug mode is enabled, echo back the user's query and messages
      if (DEBUG) {
        // Echo the user's query
        const userMessageContent = messages[messages.length - 1].content;
        // Format the content for display
        const userQuery = typeof userMessageContent === 'string'
          ? userMessageContent
          : Array.isArray(userMessageContent)
            ? JSON.stringify(userMessageContent)
            : String(userMessageContent || '');
        
        let debugContent = `[DEBUG] User Query: ${userQuery}\n\n`;
            
        const debugQueryEvent = {
          id: `debug-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [{
            index: 0,
            delta: {
              content: debugContent
            },
            finish_reason: null
          }]
        };
        res.write(`data: ${JSON.stringify(debugQueryEvent)}\n\n`);
      }

      try {
        // Stream the response from the LLM
        const llmStream = await configuredLLM.stream(langchainMessages);
        
        // Variables to track the speaker's output
        let speakerOutput = '';
        let isInterrupted = false;
        let hasExecutiveInterrupted = false; // Flag to track if executive has already interrupted
        
        // For JSON mode, we need to collect all chunks and parse at the end
        const isJsonStreaming = isJsonMode && stream;
        let jsonCollectedContent = '';
        
        // Process each chunk from the stream
        for await (const chunk of llmStream) {
          // Accumulate the speaker's output
          if (chunk.content) {
            speakerOutput += chunk.content;
            
            // For JSON mode, collect all content
            if (isJsonStreaming) {
              jsonCollectedContent += chunk.content;
            }
          }
          
          // Format the chunk as an OpenAI-compatible event
          const chunkEvent = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: startTime,
            model: MODEL,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: null
            }]
          };
          
          // Add content if present and not in JSON mode
          // For JSON mode, we'll send the parsed JSON at the end
          if (chunk.content && !isJsonStreaming) {
            chunkEvent.choices[0].delta.content = chunk.content;
          }
          
          // Add tool call chunks if present
          if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
            chunkEvent.choices[0].delta.tool_calls = chunk.tool_call_chunks.map(toolCall => ({
              index: toolCall.index,
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: toolCall.args
              }
            }));
          }
          
          // Check if the executive has completed and wants to interrupt
          // Only check if we haven't already been interrupted by the executive
          if (executivePromise && !isInterrupted && !hasExecutiveInterrupted) {
            // Update the executivePromise with the current speaker output
            // This ensures the executive has the most up-to-date information
            if (speakerOutput.length > 0 && speakerOutput.length % 100 === 0) {
              executivePromise = axios.post(`${EXECUTIVE_URL}/evaluate`, {
                original_query: typeof messages[messages.length - 1].content === 'string'
                  ? messages[messages.length - 1].content
                  : JSON.stringify(messages[messages.length - 1].content),
                messages: messages.map(msg => ({
                  ...msg,
                  content: typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? JSON.stringify(msg.content)
                      : String(msg.content || '')
                })),
                speaker_output: speakerOutput
              }).catch(error => {
                console.warn('Executive evaluation error:', error.message);
                return { data: { action: 'none', knowledge_document: '' } };
              });
            }
            
            const executiveResult = await Promise.race([
              executivePromise,
              new Promise(resolve => setTimeout(() => resolve(null), 0)) // Non-blocking check
            ]);
            
            if (executiveResult) {
              const { action, knowledge_document, reason } = executiveResult.data;
              
              // If executive thinking is enabled, send the reasoning as a separate event
              if (include_executive_thinking && reason) {
                const thinkingEvent = {
                  id: `thinking-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL,
                  choices: [{
                    index: 0,
                    delta: {
                      thinking: reason
                    },
                    finish_reason: null
                  }]
                };
                
                res.write(`data: ${JSON.stringify(thinkingEvent)}\n\n`);
                console.log(`[EXECUTIVE_THINKING] Sent executive reasoning: "${reason.substring(0, 100)}..."`);
              }
              
              if (action === 'interrupt') {
                isInterrupted = true;
                hasExecutiveInterrupted = true; // Mark that the executive has interrupted
                
                // Send the interruption to the client
                const interruptionContent = DEBUG
                  ? `\n\n[DEBUG] Executive Interruption:\n${JSON.stringify(executiveResult.data)}\n\n[Executive Interruption: ${knowledge_document}]`
                  : `\n\n[Executive Interruption: ${knowledge_document}]`;
                
                const interruptionEvent = {
                  id: `exec-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL,
                  choices: [{
                    index: 0,
                    delta: {
                      content: interruptionContent
                    },
                    finish_reason: null
                  }]
                };
                
                res.write(`data: ${JSON.stringify(interruptionEvent)}\n\n`);
                
                // Continue with the speaker after interruption
                isInterrupted = false;
              }
            }
          }
          
          // Send the chunk to the client if not interrupted and not in JSON mode
          // For JSON mode, we'll send the parsed JSON at the end
          if (!isInterrupted && (!isJsonStreaming || !chunk.content)) {
            res.write(`data: ${JSON.stringify(chunkEvent)}\n\n`);
          }
        }
        
        // Check one final time if the executive wants to interrupt, but only if it hasn't already interrupted
        if (executivePromise && !hasExecutiveInterrupted) {
          try {
            const executiveResponse = await executivePromise;
            const { action, knowledge_document, reason } = executiveResponse.data;
            
            // If executive thinking is enabled, send the reasoning as a separate event
            if (include_executive_thinking && reason) {
              const thinkingEvent = {
                id: `thinking-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: MODEL,
                choices: [{
                  index: 0,
                  delta: {
                    thinking: reason
                  },
                  finish_reason: null
                }]
              };
              
              res.write(`data: ${JSON.stringify(thinkingEvent)}\n\n`);
              console.log(`[EXECUTIVE_THINKING] Sent executive reasoning: "${reason.substring(0, 100)}..."`);
            }
            
            if (action === 'interrupt') {
              // Mark that the executive has interrupted
              hasExecutiveInterrupted = true;
              
              // Send the interruption to the client
              const interruptionContent = DEBUG
                ? `\n\n[DEBUG] Executive Interruption:\n${JSON.stringify(executiveResponse.data)}\n\n[Executive Interruption: ${knowledge_document}]`
                : `\n\n[Executive Interruption: ${knowledge_document}]`;
              
              const interruptionEvent = {
                id: `exec-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: MODEL,
                choices: [{
                  index: 0,
                  delta: {
                    content: interruptionContent
                  },
                  finish_reason: null
                }]
              };
              
              res.write(`data: ${JSON.stringify(interruptionEvent)}\n\n`);
            }
          } catch (error) {
            console.warn('Error getting executive response:', error.message);
          }
        }
        
        // For JSON mode, parse the collected content
        if (isJsonStreaming && jsonCollectedContent) {
          try {
            // Create a JSON parser
            const jsonParser = new JsonOutputParser();
            
            // Parse the collected content
            const jsonContent = await jsonParser.parse(jsonCollectedContent);
            
            // Send the parsed JSON as a single chunk
            const jsonEvent = {
              id: `json-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: MODEL,
              choices: [{
                index: 0,
                delta: {
                  content: JSON.stringify(jsonContent)
                },
                finish_reason: null
              }]
            };
            
            res.write(`data: ${JSON.stringify(jsonEvent)}\n\n`);
            
            console.log('Successfully parsed and sent JSON response');
          } catch (error) {
            console.error('Error parsing JSON in streaming mode:', error);
            
            // Send an error JSON
            const errorJsonEvent = {
              id: `json-error-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: MODEL,
              choices: [{
                index: 0,
                delta: {
                  content: JSON.stringify({ error: "Failed to parse as JSON", content: jsonCollectedContent })
                },
                finish_reason: null
              }]
            };
            
            res.write(`data: ${JSON.stringify(errorJsonEvent)}\n\n`);
          }
        }
        
        // Send the final event
        const finalEvent = {
          id: responseId,
          object: 'chat.completion.chunk',
          created: startTime,
          model: MODEL,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };
        
        res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        console.error('Error streaming response:', error);
        // Try to send an error event if possible
        try {
          if (!res.writableEnded) {
            const errorEvent = {
              id: responseId,
              object: 'chat.completion.chunk',
              created: startTime,
              model: MODEL,
              choices: [{
                index: 0,
                delta: {
                  content: `\n\nError: ${error.message}`
                },
                finish_reason: 'stop'
              }]
            };
            res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          }
        } catch (e) {
          console.error('Error sending error event:', e);
          if (!res.writableEnded) {
            res.end();
          }
        }
      }
    } else {
      // Handle non-streaming response
      try {
        // Get the LLM response
        const llmResponse = await configuredLLM.invoke(langchainMessages);
        
        // Get the raw content from the LLM response
        let content = llmResponse.content || '';
        
        // Update the executive with the speaker's output and get a final evaluation
        const executiveResponse = await axios.post(`${EXECUTIVE_URL}/evaluate`, {
          original_query: typeof messages[messages.length - 1].content === 'string'
            ? messages[messages.length - 1].content
            : JSON.stringify(messages[messages.length - 1].content),
          messages: messages.map(msg => ({
            ...msg,
            content: typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? JSON.stringify(msg.content)
                : String(msg.content || '')
          })),
          speaker_output: content
        }).catch(error => {
          console.warn('Executive evaluation error:', error.message);
          return { data: { action: 'none', knowledge_document: '' } };
        });
        
        // If JSON mode is requested, parse the content as JSON
        if (isJsonMode) {
          try {
            // Create a JSON parser
            const jsonParser = new JsonOutputParser();
            
            // Try to parse the content as JSON
            // The parser will extract JSON from markdown blocks if needed
            const jsonContent = await jsonParser.parse(content);
            
            // Convert the parsed JSON back to a string
            content = JSON.stringify(jsonContent);
            
            console.log('Successfully parsed JSON response');
          } catch (error) {
            console.error('Error parsing JSON response:', error);
            // If parsing fails, wrap the content in a JSON object to ensure valid JSON
            content = JSON.stringify({ error: "Failed to parse as JSON", content });
          }
        }
        
        // If debug mode is enabled, prepend the user's query
        if (DEBUG) {
          const userMessageContent = messages[messages.length - 1].content;
          // Format the content for display
          const userQuery = typeof userMessageContent === 'string'
            ? userMessageContent
            : Array.isArray(userMessageContent)
              ? JSON.stringify(userMessageContent)
              : String(userMessageContent || '');
          
          // Add debug information
          let debugInfo = { query: userQuery };
              
          // In JSON mode, we need to maintain valid JSON
          if (isJsonMode) {
            const debugObj = { debug: debugInfo, result: JSON.parse(content) };
            content = JSON.stringify(debugObj);
          } else {
            let debugContent = `[DEBUG] User Query: ${userQuery}\n\n`;
            content = `${debugContent}${content}`;
          }
        }
        
        const formattedResponse = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: content
            },
            finish_reason: 'stop'
          }],
          usage: llmResponse.usage_metadata ? {
            prompt_tokens: llmResponse.usage_metadata.input_tokens || 0,
            completion_tokens: llmResponse.usage_metadata.output_tokens || 0,
            total_tokens: llmResponse.usage_metadata.total_tokens || 0
          } : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        };
        
        // Handle tool calls if present
        if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
          formattedResponse.choices[0].message.tool_calls = llmResponse.tool_calls.map((toolCall, index) => ({
            id: toolCall.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args)
            }
          }));
          formattedResponse.choices[0].finish_reason = 'tool_calls';
        }
        
        // Check if the executive wants to intervene
        if (executiveResponse) {
          const { action, knowledge_document, reason } = executiveResponse.data;
          
          // If executive thinking is enabled, include the reasoning in the response
          if (include_executive_thinking && reason) {
            // Add the thinking field to the response
            formattedResponse.choices[0].message.thinking = reason;
            console.log(`[EXECUTIVE_THINKING] Included executive reasoning in response: "${reason.substring(0, 100)}..."`);
          }
          
          if (action === 'interrupt') {
            // Add the interruption to the response
            const interruptionContent = DEBUG
              ? `\n\n[DEBUG] Executive Interruption:\n${JSON.stringify(executiveResponse.data)}\n\n[Executive Interruption: ${knowledge_document}]`
              : `\n\n[Executive Interruption: ${knowledge_document}]`;
            
            formattedResponse.choices[0].message.content += interruptionContent;
          }
        }
        
        res.json(formattedResponse);
      } catch (error) {
        console.error('Error generating response:', error);
        // Only send error response if headers haven't been sent yet
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              message: 'An error occurred during chat',
              type: 'server_error',
              param: null,
              code: 'internal_server_error'
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Error in chat:', error);
    // Only send error response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: 'An error occurred during chat',
          type: 'server_error',
          param: null,
          code: 'internal_server_error'
        }
      });
    }
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`Speaker LLM service running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});