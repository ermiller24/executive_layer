import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { initChatModel } from "langchain/chat_models/universal";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChromaClient, DefaultEmbeddingFunction } from 'chromadb';

dotenv.config();
const app = express();
app.use(express.json());

// Configuration from environment variables
const PORT = process.env.API_PORT || 3000;
const SPEAKER_PORT = process.env.SPEAKER_PORT || 8002;
const EXECUTIVE_URL = process.env.EXECUTIVE_URL || 'http://executive:8001';
const CHROMA_URL = process.env.CHROMA_URL || 'http://chroma:8000';
const DEBUG = process.env.DEBUG === 'true';

// Log debug status
console.log(`Debug mode: ${DEBUG ? 'enabled' : 'disabled'}`);

// Collection name for storing embeddings
const COLLECTION_NAME = 'eir_embeddings';

// Initialize Chroma client and embedding function
const chromaClient = new ChromaClient({ path: CHROMA_URL });
const embeddingFunction = new DefaultEmbeddingFunction();

// Initialize the Chroma collection
async function initializeCollection() {
  try {
    // Check if collection exists by listing all collections
    const collections = await chromaClient.listCollections();
    const collectionExists = collections.some(collection => collection.name === COLLECTION_NAME);

    if (!collectionExists) {
      // Create collection
      await chromaClient.createCollection({
        name: COLLECTION_NAME,
        metadata: { description: "EIR embeddings collection" },
        embeddingFunction: embeddingFunction
      });
      console.log(`Created collection ${COLLECTION_NAME}`);
    } else {
      console.log(`Collection ${COLLECTION_NAME} already exists`);
    }

    // Get the collection
    const collection = await chromaClient.getCollection({
      name: COLLECTION_NAME,
      embeddingFunction: embeddingFunction
    });
    console.log(`Successfully connected to collection ${COLLECTION_NAME}`);
    
    return collection;
  } catch (error) {
    console.error('Error initializing Chroma collection:', error);
    console.warn('Vector store functionality will be limited');
    return null;
  }
}

// Initialize the collection
let chromaCollection;
initializeCollection()
  .then(collection => {
    chromaCollection = collection;
    console.log('ChromaDB collection initialized successfully');
  })
  .catch(error => {
    console.error('Failed to initialize ChromaDB collection:', error);
    console.warn('Vector store functionality will be limited');
  });

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
      response_format
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
    const userMessage = messages[messages.length - 1].content;
    // Query the vector store for relevant context
    let vectorStoreContext = null;
    try {
      if (chromaCollection) {
        console.log(`[VECTOR_STORE] Querying ChromaDB for context related to: "${userMessage.substring(0, 50)}..."`);
        
        // Search for similar items in ChromaDB using the built-in embedding function
        const searchResult = await chromaCollection.query({
          queryTexts: [userMessage],
          nResults: 3,
        });
        
        if (searchResult && searchResult.ids && searchResult.ids.length > 0 && searchResult.ids[0].length > 0) {
          // Format results
          vectorStoreContext = searchResult.ids[0].map((id, index) => ({
            id: id,
            text: searchResult.documents[0][index],
            metadata: searchResult.metadatas[0][index],
            timestamp: searchResult.metadatas[0][index].timestamp,
            score: searchResult.distances[0][index]
          }));
          
          console.log(`[VECTOR_STORE] Found ${vectorStoreContext.length} relevant items in vector store`);
          vectorStoreContext.forEach((item, i) => {
            console.log(`[VECTOR_STORE] Result ${i+1}: ID=${item.id}, Score=${item.score.toFixed(4)}, Timestamp=${item.timestamp}`);
            console.log(`[VECTOR_STORE] Content snippet: "${item.text.substring(0, 100)}..."`);
          });
        } else {
          console.log('[VECTOR_STORE] No relevant items found in vector store');
        }
      } else {
        console.warn('[VECTOR_STORE] ChromaDB collection not available, skipping context retrieval');
      }
    } catch (error) {
      console.warn('[VECTOR_STORE] Error querying vector store:', error.message);
      // Continue without vector store context
    }

    // Prepare messages with vector store context if available
    const speakerMessages = [...messages];
    
    if (vectorStoreContext) {
      // Insert vector store context as a system message before the user's message
      const contextMessage = {
        role: 'system',
        content: `Relevant context from previous conversations:\n${vectorStoreContext.map(item => item.text).join('\n\n')}`
      };
      
      // Insert before the last message (which is the user's message)
      speakerMessages.splice(speakerMessages.length - 1, 0, contextMessage);
    }

    // Start the executive process in parallel
    const executiveRequest = {
      original_query: userMessage,
      messages: messages,
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

// OpenAI-compatible embeddings endpoint
app.post('/v1/embeddings', async (req, res) => {
  try {
    // Extract request parameters
    const { model = 'eir-embedding', input, user } = req.body;
    
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
    
    // Generate embeddings using ChromaDB's default embedding function
    const embeddingArrays = await Promise.all(
      inputArray.map(t => embeddingFunction.generate(t))
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
      if (msg.role === 'user') {
        langchainMessages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        langchainMessages.push(new AIMessage(msg.content));
      } else if (msg.role === 'system') {
        langchainMessages.push(new SystemMessage(msg.content));
      } else {
        langchainMessages.push(new HumanMessage(msg.content));
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
        const userQuery = messages[messages.length - 1].content;
        const debugQueryEvent = {
          id: `debug-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [{
            index: 0,
            delta: {
              content: `[DEBUG] User Query: ${userQuery}\n\n`
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
            
            // We accumulate the speaker's output but don't send non-blocking updates
            // The executive will receive the full output when it's checked for interruption
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
          if (executivePromise && !isInterrupted) {
            // Update the executivePromise with the current speaker output
            // This ensures the executive has the most up-to-date information
            if (speakerOutput.length > 0 && speakerOutput.length % 100 === 0) {
              executivePromise = axios.post(`${EXECUTIVE_URL}/evaluate`, {
                original_query: messages[messages.length - 1].content,
                messages: messages,
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
              
              if (action === 'interrupt') {
                isInterrupted = true;
                
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
              } else if (action === 'restart') {
                // For restart, we'll stop the current stream and start a new one
                // with the knowledge document included
                isInterrupted = true;
                
                // Send a message indicating the restart
                const restartContent = DEBUG
                  ? `\n\n[DEBUG] Executive Restart:\n${JSON.stringify(executiveResult.data)}\n\n[Executive restarting with updated information]`
                  : `\n\n[Executive restarting with updated information]`;
                
                const restartEvent = {
                  id: `exec-restart-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL,
                  choices: [{
                    index: 0,
                    delta: {
                      content: restartContent
                    },
                    finish_reason: null
                  }]
                };
                
                res.write(`data: ${JSON.stringify(restartEvent)}\n\n`);
                
                // Create a new set of messages with the knowledge document
                const updatedMessages = [...messages];
                
                // Add the knowledge document as a system message
                updatedMessages.splice(updatedMessages.length - 1, 0, {
                  role: 'system',
                  content: `Updated information: ${knowledge_document}`
                });
                
                // Convert to LangChain format
                const updatedLangchainMessages = [];
                for (const msg of updatedMessages) {
                  if (msg.role === 'user') {
                    updatedLangchainMessages.push(new HumanMessage(msg.content));
                  } else if (msg.role === 'assistant') {
                    updatedLangchainMessages.push(new AIMessage(msg.content));
                  } else if (msg.role === 'system') {
                    updatedLangchainMessages.push(new SystemMessage(msg.content));
                  } else {
                    updatedLangchainMessages.push(new HumanMessage(msg.content));
                  }
                }
                
                // Send a separator to indicate the start of the new response
                const separatorEvent = {
                  id: `separator-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: MODEL,
                  choices: [{
                    index: 0,
                    delta: {
                      content: '\n\n'
                    },
                    finish_reason: null
                  }]
                };
                
                res.write(`data: ${JSON.stringify(separatorEvent)}\n\n`);
                
                try {
                  // Start a new stream with the updated messages
                  const newLlmStream = await configuredLLM.stream(updatedLangchainMessages);
                  
                  // Reset tracking variables
                  speakerOutput = '';
                  isInterrupted = false;
                  if (isJsonStreaming) {
                    jsonCollectedContent = '';
                  }
                  
                  // Process each chunk from the new stream
                  for await (const chunk of newLlmStream) {
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
                    
                    // Send the chunk to the client
                    res.write(`data: ${JSON.stringify(chunkEvent)}\n\n`);
                  }
                } catch (error) {
                  console.error('Error in restarted stream:', error);
                  
                  // Send an error event
                  const errorEvent = {
                    id: `error-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: MODEL,
                    choices: [{
                      index: 0,
                      delta: {
                        content: `\n\nError in restarted response: ${error.message}`
                      },
                      finish_reason: null
                    }]
                  };
                  
                  res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
                }
                
                // Break out of the original streaming loop
                break;
              }
            }
          }
          
          // Send the chunk to the client if not interrupted and not in JSON mode
          // For JSON mode, we'll send the parsed JSON at the end
          if (!isInterrupted && (!isJsonStreaming || !chunk.content)) {
            res.write(`data: ${JSON.stringify(chunkEvent)}\n\n`);
          }
        }
        
        // Check one final time if the executive wants to interrupt
        if (executivePromise) {
          try {
            const executiveResponse = await executivePromise;
            const { action, knowledge_document } = executiveResponse.data;
            
            if (action === 'interrupt') {
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
        
        // Store the conversation in the vector store for future reference
        try {
          if (chromaCollection) {
            const id = `stream-${Date.now()}`;
            const timestamp = new Date().toISOString();
            console.log(`[VECTOR_STORE] Storing streaming response in ChromaDB with ID: ${id}`);
            console.log(`[VECTOR_STORE] Content length: ${speakerOutput.length} characters`);
            
            // Store in ChromaDB using the built-in embedding function
            await chromaCollection.add({
              ids: [id],
              documents: [speakerOutput],
              metadatas: [{
                query: messages[messages.length - 1].content,
                timestamp: timestamp,
                source: 'speaker-stream'
              }]
            });
            
            console.log(`[VECTOR_STORE] Successfully stored streaming response in ChromaDB at ${timestamp}`);
          }
        } catch (error) {
          console.warn('[VECTOR_STORE] Error storing in vector store:', error.message);
        }
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
          original_query: messages[messages.length - 1].content,
          messages: messages,
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
          const userQuery = messages[messages.length - 1].content;
          // In JSON mode, we need to maintain valid JSON
          if (isJsonMode) {
            const debugObj = { debug: { query: userQuery }, result: JSON.parse(content) };
            content = JSON.stringify(debugObj);
          } else {
            content = `[DEBUG] User Query: ${userQuery}\n\n${content}`;
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
          const { action, knowledge_document } = executiveResponse.data;
          
          if (action === 'interrupt') {
            // Add the interruption to the response
            const interruptionContent = DEBUG
              ? `\n\n[DEBUG] Executive Interruption:\n${JSON.stringify(executiveResponse.data)}\n\n[Executive Interruption: ${knowledge_document}]`
              : `\n\n[Executive Interruption: ${knowledge_document}]`;
            
            formattedResponse.choices[0].message.content += interruptionContent;
          } else if (action === 'restart') {
            // Create a new response with the knowledge document
            const updatedMessages = [...messages];
            
            // Add the knowledge document as a system message
            updatedMessages.splice(updatedMessages.length - 1, 0, {
              role: 'system',
              content: `Updated information: ${knowledge_document}`
            });
            
            // Convert to LangChain format
            const updatedLangchainMessages = [];
            for (const msg of updatedMessages) {
              if (msg.role === 'user') {
                updatedLangchainMessages.push(new HumanMessage(msg.content));
              } else if (msg.role === 'assistant') {
                updatedLangchainMessages.push(new AIMessage(msg.content));
              } else if (msg.role === 'system') {
                updatedLangchainMessages.push(new SystemMessage(msg.content));
              } else {
                updatedLangchainMessages.push(new HumanMessage(msg.content));
              }
            }
            
            // Get a new response
            const newLlmResponse = await configuredLLM.invoke(updatedLangchainMessages);
            
            // Update the formatted response
            let restartContent = newLlmResponse.content || '';
            
            // If debug mode is enabled, include the executive response data
            if (DEBUG) {
              restartContent = `[DEBUG] Executive Restart:\n${JSON.stringify(executiveResponse.data)}\n\n${restartContent}`;
            }
            
            formattedResponse.choices[0].message.content = `[Executive restarted with updated information]\n\n${restartContent}`;
            
            // Update tool calls if present
            if (newLlmResponse.tool_calls && newLlmResponse.tool_calls.length > 0) {
              formattedResponse.choices[0].message.tool_calls = newLlmResponse.tool_calls.map((toolCall, index) => ({
                id: toolCall.id || `call_${Date.now()}_${index}`,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: typeof toolCall.args === 'string' ? toolCall.args : JSON.stringify(toolCall.args)
                }
              }));
              formattedResponse.choices[0].finish_reason = 'tool_calls';
            }
          }
        }
        
        // Store the conversation in the vector store for future reference
        try {
          if (chromaCollection) {
            let contentToStore = formattedResponse.choices[0].message.content || '';
            
            // If there are tool calls, include them in the stored content
            if (formattedResponse.choices[0].message.tool_calls) {
              contentToStore += '\n\nTool Calls: ' + JSON.stringify(formattedResponse.choices[0].message.tool_calls);
            }
            
            const id = `nonstream-${Date.now()}`;
            const timestamp = new Date().toISOString();
            console.log(`[VECTOR_STORE] Storing non-streaming response in ChromaDB with ID: ${id}`);
            console.log(`[VECTOR_STORE] Content length: ${contentToStore.length} characters`);
            
            // Store in ChromaDB using the built-in embedding function
            await chromaCollection.add({
              ids: [id],
              documents: [contentToStore],
              metadatas: [{
                query: messages[messages.length - 1].content,
                timestamp: timestamp,
                source: 'speaker-nonstream'
              }]
            });
            
            console.log(`[VECTOR_STORE] Successfully stored non-streaming response in ChromaDB at ${timestamp}`);
          }
        } catch (error) {
          console.warn('[VECTOR_STORE] Error storing in vector store:', error.message);
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