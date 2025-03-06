const axios = require('axios');

/**
 * Handles chat completion requests in an OpenAI-compatible way
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} options - Configuration options
 */
async function handleChatCompletion(req, res, options) {
  const { 
    speakerUrl, 
    executiveUrl, 
    vectorStoreUrl,
    speakerConfig,
    executiveConfig
  } = options;
  
  // Extract request parameters
  const {
    model,
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

  try {
    // First, query the vector store for relevant context
    const userMessage = messages[messages.length - 1].content;
    let vectorStoreContext = null;
    
    try {
      const vectorResponse = await axios.post(`${vectorStoreUrl}/query`, {
        query: userMessage,
        top_k: 3
      });
      
      if (vectorResponse.data && vectorResponse.data.results && vectorResponse.data.results.length > 0) {
        vectorStoreContext = vectorResponse.data.results;
      }
    } catch (error) {
      console.warn('Error querying vector store:', error.message);
      // Continue without vector store context
    }

    // Prepare messages for the speaker with vector store context if available
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

    // Prepare the request to the speaker
    const speakerRequest = {
      messages: speakerMessages,
      temperature,
      stream,
      max_tokens,
      presence_penalty,
      frequency_penalty
    };

    // Add model configuration if provided
    if (speakerConfig) {
      speakerRequest.model = speakerConfig.model;
      speakerRequest.modelProvider = speakerConfig.modelProvider;
      speakerRequest.apiKey = speakerConfig.apiKey;
      speakerRequest.apiBase = speakerConfig.apiBase;
    }

    // Add tools if provided
    if (tools && Array.isArray(tools) && tools.length > 0) {
      speakerRequest.tools = tools;
    }

    // Add tool_choice if provided
    if (tool_choice) {
      speakerRequest.tool_choice = tool_choice;
    }

    // Add response_format if provided
    if (response_format) {
      speakerRequest.response_format = response_format;
    }

    if (stream) {
      // Handle streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Start the speaker stream
      const speakerResponse = await axios.post(`${speakerUrl}/chat`, speakerRequest, {
        responseType: 'stream'
      });

      // Prepare the executive request
      const executiveRequest = {
        original_query: userMessage,
        messages: messages
      };

      // Add model configuration if provided
      if (executiveConfig) {
        executiveRequest.model = executiveConfig.model;
        executiveRequest.modelProvider = executiveConfig.modelProvider;
        executiveRequest.apiKey = executiveConfig.apiKey;
        executiveRequest.apiBase = executiveConfig.apiBase;
      }

      // Start the executive process in parallel
      const executivePromise = axios.post(`${executiveUrl}/evaluate`, executiveRequest);

      // Pipe the speaker's stream to the client
      let speakerOutput = '';
      let isInterrupted = false;
      let toolCallsInProgress = false;
      let toolCallsData = [];

      speakerResponse.data.on('data', async (chunk) => {
        try {
          const chunkStr = chunk.toString();
          speakerOutput += chunkStr;
          
          // Forward the chunk to the client
          if (!isInterrupted) {
            // Check if this is a tool call chunk
            if (chunkStr.includes('"tool_calls":') || toolCallsInProgress) {
              toolCallsInProgress = true;
              toolCallsData.push(chunkStr);
            } else {
              res.write(chunkStr);
            }
          }
        } catch (error) {
          console.error('Error processing stream chunk:', error);
          // Continue processing even if there's an error with one chunk
        }
      });

      // When the executive is done, check if we need to interrupt
      executivePromise.then(async (executiveResponse) => {
        const { action, knowledge_document } = executiveResponse.data;
        
        if (action === 'interrupt') {
          isInterrupted = true;
          
          // Send the interruption to the client
          const interruptionEvent = {
            id: `exec-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model || 'eir-default',
            choices: [{
              index: 0,
              delta: {
                content: `\n\n[Executive Interruption: ${knowledge_document}]`
              },
              finish_reason: null
            }]
          };
          
          res.write(`data: ${JSON.stringify(interruptionEvent)}\n\n`);
          
          // Continue with the speaker after interruption
          isInterrupted = false;
        } else if (action === 'restart') {
          isInterrupted = true;
          
          // Send the restart notification to the client
          const restartEvent = {
            id: `exec-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model || 'eir-default',
            choices: [{
              index: 0,
              delta: {
                content: `\n\n[Executive is restarting with updated information]`
              },
              finish_reason: null
            }]
          };
          
          res.write(`data: ${JSON.stringify(restartEvent)}\n\n`);
          
          // Start a new speaker stream with the knowledge document
          const updatedMessages = [...messages];
          
          // Add the knowledge document as a system message
          updatedMessages.splice(updatedMessages.length - 1, 0, {
            role: 'system',
            content: `Updated information: ${knowledge_document}`
          });
          
          // Update the speaker request with the new messages
          const newSpeakerRequest = {
            ...speakerRequest,
            messages: updatedMessages,
          };
          
          const newSpeakerResponse = await axios.post(`${speakerUrl}/chat`, newSpeakerRequest, {
            responseType: 'stream'
          });
          
          // Pipe the new speaker's stream to the client
          newSpeakerResponse.data.on('data', (chunk) => {
            res.write(chunk.toString());
          });
          
          newSpeakerResponse.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
          });
        }
      }).catch(error => {
        console.error('Executive evaluation error:', error);
        // Continue with the speaker stream even if executive fails
      });

      speakerResponse.data.on('end', () => {
        try {
          if (!isInterrupted) {
            // If we collected tool calls data, process and send it now
            if (toolCallsInProgress && toolCallsData.length > 0) {
              try {
                // Combine all tool call chunks and send them
                const combinedData = toolCallsData.join('');
                res.write(combinedData);
              } catch (error) {
                console.error('Error processing tool calls data:', error);
              }
            }
            
            res.write('data: [DONE]\n\n');
            res.end();
          }
          
          // Store the conversation in the vector store for future reference
          try {
            axios.post(`${vectorStoreUrl}/store`, {
              text: speakerOutput,
              metadata: {
                query: userMessage,
                timestamp: new Date().toISOString()
              }
            }).catch(error => {
              console.warn('Error storing in vector store:', error.message);
            });
          } catch (error) {
            console.warn('Error storing in vector store:', error.message);
          }
        } catch (error) {
          console.error('Error in stream end handler:', error);
          // Ensure we end the response even if there's an error
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }
      });
    } else {
      // Handle non-streaming response
      // Prepare the executive request
      const executiveRequest = {
        original_query: userMessage,
        messages: messages
      };

      // Add model configuration if provided
      if (executiveConfig) {
        executiveRequest.model = executiveConfig.model;
        executiveRequest.modelProvider = executiveConfig.modelProvider;
        executiveRequest.apiKey = executiveConfig.apiKey;
        executiveRequest.apiBase = executiveConfig.apiBase;
      }

      // Start both speaker and executive in parallel
      let speakerResponse, executiveResponse;
      try {
        [speakerResponse, executiveResponse] = await Promise.all([
          axios.post(`${speakerUrl}/chat`, speakerRequest),
          axios.post(`${executiveUrl}/evaluate`, executiveRequest).catch(err => {
            console.warn('Executive evaluation error:', err.message);
            // Return a default response if executive fails
            return { data: { action: 'none', knowledge_document: '' } };
          })
        ]);
      } catch (error) {
        // If speaker fails, we can't continue
        throw error;
      }

      const { action, knowledge_document } = executiveResponse.data;
      let finalResponse = speakerResponse.data;
      
      if (action === 'interrupt') {
        // Add the interruption to the response
        if (finalResponse.choices[0].message.tool_calls) {
          // If there are tool calls, we can't modify the content directly
          // Instead, add a new message to indicate the interruption
          finalResponse.choices[0].message.content = finalResponse.choices[0].message.content || '';
          finalResponse.choices[0].message.content += `\n\n[Executive Interruption: ${knowledge_document}]`;
        } else {
          finalResponse.choices[0].message.content += `\n\n[Executive Interruption: ${knowledge_document}]`;
        }
      } else if (action === 'restart') {
        // Create a new response with the knowledge document
        const updatedMessages = [...messages];
        
        // Add the knowledge document as a system message
        updatedMessages.splice(updatedMessages.length - 1, 0, {
          role: 'system',
          content: `Updated information: ${knowledge_document}`
        });
        
        // Update the speaker request with the new messages
        const newSpeakerRequest = {
          ...speakerRequest,
          messages: updatedMessages,
          stream: false
        };
        
        const newSpeakerResponse = await axios.post(`${speakerUrl}/chat`, newSpeakerRequest);
        
        finalResponse = newSpeakerResponse.data;
        
        // If there are no tool calls, we can modify the content directly
        if (!finalResponse.choices[0].message.tool_calls) {
          finalResponse.choices[0].message.content = `[Executive restarted with updated information]\n\n${finalResponse.choices[0].message.content}`;
        }
      }
      
      // Store the conversation in the vector store for future reference
      try {
        let contentToStore = finalResponse.choices[0].message.content || '';
        
        // If there are tool calls, include them in the stored content
        if (finalResponse.choices[0].message.tool_calls) {
          contentToStore += '\n\nTool Calls: ' + JSON.stringify(finalResponse.choices[0].message.tool_calls);
        }
        
        axios.post(`${vectorStoreUrl}/store`, {
          text: contentToStore,
          metadata: {
            query: userMessage,
            timestamp: new Date().toISOString()
          }
        }).catch(error => {
          console.warn('Error storing in vector store:', error.message);
        });
      } catch (error) {
        console.warn('Error storing in vector store:', error.message);
      }
      
      // Send the final response
      res.json(finalResponse);
    }
  } catch (error) {
    console.error('Error in chat completion:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during chat completion',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
}

module.exports = { handleChatCompletion };