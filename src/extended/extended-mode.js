import ThreadManager from './thread-manager.js';
import ProgressTracker from './progress-tracker.js';
import ContextManager from './context-manager.js';
import axios from 'axios';

/**
 * ExtendedMode class for managing extended response mode
 * Integrates ThreadManager, ProgressTracker, and ContextManager
 */
class ExtendedMode {
  constructor(options = {}) {
    // Configuration options
    this.dataDir = options.dataDir || './data';
    this.maxContextSize = options.maxContextSize || 16000;
    this.summarizationThreshold = options.summarizationThreshold || 0.7;
    this.preserveMessageCount = options.preserveMessageCount || 4;
    this.expirationTime = options.expirationTime || 24 * 60 * 60 * 1000; // 24 hours
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // 1 hour
    this.summaryModel = options.summaryModel || 'openai:gpt-3.5-turbo';
    this.summaryModelKwargs = options.summaryModelKwargs || {};
    this.executiveUrl = options.executiveUrl || 'http://executive:8001';
    
    // Component instances
    this.threadManager = new ThreadManager({
      dbPath: `${this.dataDir}/threads.db`,
      expirationTime: this.expirationTime,
      cleanupInterval: this.cleanupInterval
    });
    
    this.progressTracker = new ProgressTracker({
      threadManager: this.threadManager,
      progressDir: `${this.dataDir}/progress`
    });
    
    this.contextManager = new ContextManager({
      threadManager: this.threadManager,
      progressTracker: this.progressTracker,
      maxContextSize: this.maxContextSize,
      summarizationThreshold: this.summarizationThreshold,
      preserveMessageCount: this.preserveMessageCount,
      summaryModel: this.summaryModel,
      summaryModelKwargs: this.summaryModelKwargs
    });
    
    this.initialized = false;
  }

  /**
   * Initialize the ExtendedMode and all its components
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.threadManager.initialize();
      await this.progressTracker.initialize();
      await this.contextManager.initialize();
      
      this.initialized = true;
      console.log('ExtendedMode initialized successfully');
    } catch (error) {
      console.error('Error initializing ExtendedMode:', error);
      throw error;
    }
  }

  /**
   * Generate a response plan for a new thread
   * @param {string} threadId - The thread ID
   * @param {Array} messages - The conversation messages
   * @returns {Promise<string>} - The generated response plan
   */
  async generateResponsePlan(threadId, messages) {
    try {
      // Get the last user message
      const lastUserMessage = messages.find(msg => msg.role === 'user');
      
      if (!lastUserMessage) {
        return 'No user message found to generate a response plan.';
      }
      
      console.log(`[EXTENDED_MODE] Generating response plan for thread ${threadId}`);
      
      try {
        // Call the executive service to generate a response plan
        const response = await axios.post(`${this.executiveUrl}/generate_response_plan`, {
          query: lastUserMessage.content,
          messages: messages
        });
        
        console.log(`[EXTENDED_MODE] Response plan generated for thread ${threadId}`);
        
        if (response.data && response.data.response_plan) {
          return response.data.response_plan;
        } else {
          console.error(`[EXTENDED_MODE] No response plan in response for thread ${threadId}`);
          return 'Failed to generate a response plan.';
        }
      } catch (error) {
        console.error(`[EXTENDED_MODE] Error calling executive service for thread ${threadId}:`, error.message);
        if (error.response) {
          console.error(`[EXTENDED_MODE] Response status: ${error.response.status}`);
          console.error(`[EXTENDED_MODE] Response data:`, error.response.data);
        }
        return `Error generating response plan: ${error.message}. Proceeding with default response.`;
      }
    } catch (error) {
      console.error(`[EXTENDED_MODE] Error in generateResponsePlan for thread ${threadId}:`, error);
      return 'Error generating response plan. Proceeding with default response.';
    }
  }

  /**
   * Process a request in extended mode
   * @param {Object} req - The request object
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - The processed request with updated messages
   */
  async processRequest(req, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const { extended_thread_id } = req.body;
      
      if (!extended_thread_id) {
        throw new Error('extended_thread_id is required for extended mode');
      }
      
      console.log(`[EXTENDED_MODE] Processing request for thread ${extended_thread_id}`);
      
      // Get the thread or create a new one
      const thread = await this.threadManager.getOrCreateThread(extended_thread_id);
      
      // Get the new messages from the request
      const newMessages = req.body.messages || [];
      
      // If this is a new thread, implement the executive-first flow
      if (thread.messageCount === 0) {
        console.log(`[EXTENDED_MODE] New thread ${extended_thread_id} detected, initializing with executive-first flow...`);
        
        // Add the messages to the thread
        await this.threadManager.addMessagesToThread(extended_thread_id, newMessages);
        console.log(`[EXTENDED_MODE] Added ${newMessages.length} messages to thread ${extended_thread_id}`);
        
        // Create an initial progress document with placeholder
        const initialProgress = `# Extended Response: ${extended_thread_id}\n\n## Initial Request\n\n${
          newMessages.length > 0 ? newMessages[newMessages.length - 1].content : 'No initial message'
        }\n\n## Response Plan\n\nGenerating executive response plan...`;
        
        console.log(`[EXTENDED_MODE] Creating initial progress document for thread ${extended_thread_id}`);
        await this.progressTracker.updateProgressDocument(extended_thread_id, initialProgress);
        
        try {
          // Generate a response plan using the executive
          console.log(`[EXTENDED_MODE] Generating executive response plan for thread ${extended_thread_id}`);
          const responsePlan = await this.generateResponsePlan(extended_thread_id, newMessages);
          console.log(`[EXTENDED_MODE] Executive response plan generated for thread ${extended_thread_id} (${responsePlan.length} chars)`);
          
          // Update the progress document with the response plan
          console.log(`[EXTENDED_MODE] Updating progress document with executive response plan for thread ${extended_thread_id}`);
          
          // Create a detailed response plan if the generated one is too short or generic
          let finalResponsePlan = responsePlan;
          if (responsePlan.length < 50 || responsePlan.includes('Error generating response plan') ||
              responsePlan.includes('Failed to generate') || responsePlan.includes('Proceeding with default')) {
            console.log(`[EXTENDED_MODE] Generated response plan is too short or contains errors, creating a default plan`);
            finalResponsePlan = `# Executive Response Plan for Query: ${newMessages[newMessages.length - 1].content}\n\n` +
              `1. Understand the user's query about ${newMessages[newMessages.length - 1].content.substring(0, 30)}...\n` +
              `2. Research relevant information from available knowledge sources\n` +
              `3. Organize information in a logical structure\n` +
              `4. Present information clearly and concisely\n` +
              `5. Address all aspects of the user's query\n` +
              `6. Provide additional context where helpful\n\n` +
              `Note: This is a default response plan. The executive service was unable to generate a custom plan.`;
          }
          
          await this.progressTracker.replaceSectionInProgressDocument(
            extended_thread_id,
            'Response Plan',
            finalResponsePlan
          );
          console.log(`[EXTENDED_MODE] Progress document updated with executive response plan for thread ${extended_thread_id}`);
          
          // Verify the update
          const updatedDoc = await this.progressTracker.getProgressDocument(extended_thread_id);
          if (updatedDoc.includes('Generating executive response plan...')) {
            console.error(`[EXTENDED_MODE] Response plan was not updated correctly in the progress document`);
          } else {
            console.log(`[EXTENDED_MODE] Response plan successfully updated in progress document`);
          }
          
          // Add system message with the response plan to guide the speaker
          const systemMessage = {
            role: 'system',
            content: `You are responding in Extended Response Mode. Follow this executive response plan:\n\n${finalResponsePlan}`
          };
          
          // Add the system message to the beginning of the messages array
          newMessages.unshift(systemMessage);
          console.log(`[EXTENDED_MODE] Added executive response plan as system message to guide the speaker`);
        } catch (error) {
          console.error(`[EXTENDED_MODE] Error generating or updating response plan for thread ${extended_thread_id}:`, error);
          // Continue without the response plan, but add a basic system message
          newMessages.unshift({
            role: 'system',
            content: 'You are responding in Extended Response Mode. Provide a comprehensive and structured response.'
          });
        }
        
        // Return the request with the modified messages (including the response plan as a system message)
        return {
          ...req,
          body: {
            ...req.body,
            messages: newMessages,
            vector_store_disabled: true, // Disable vector store in extended mode
            executive_first: true // Flag to indicate executive-first flow
          }
        };
      } else {
        // For existing threads, treat user messages as another form of executive oversight
        // Do not generate a new response plan or have the executive interrupt
        console.log(`[EXTENDED_MODE] Existing thread ${extended_thread_id}, treating user message as executive oversight`);
        
        // Add the new messages to the thread
        await this.threadManager.addMessagesToThread(extended_thread_id, newMessages);
        console.log(`[EXTENDED_MODE] Added ${newMessages.length} messages to thread ${extended_thread_id}`);
        
        // Update the progress document with the new user message
        const lastUserMessage = newMessages.find(msg => msg.role === 'user');
        if (lastUserMessage) {
          await this.progressTracker.addSectionToProgressDocument(
            extended_thread_id,
            'Latest User Message',
            lastUserMessage.content
          );
          console.log(`[EXTENDED_MODE] Updated progress document with latest user message for thread ${extended_thread_id}`);
        }
        
        // Get all messages for the thread
        console.log(`[EXTENDED_MODE] Retrieving all messages for thread ${extended_thread_id}`);
        const allMessages = await this.threadManager.getMessagesForThread(extended_thread_id);
        console.log(`[EXTENDED_MODE] Retrieved ${allMessages.length} messages for thread ${extended_thread_id}`);
        
        // Check if we need to summarize the conversation
        const contextManager = new ContextManager(this.progressTracker);
        const { messages: processedMessages, summarized } = await contextManager.processMessages(extended_thread_id, allMessages);
        
        if (summarized) {
          console.log(`[EXTENDED_MODE] Conversation was summarized for thread ${extended_thread_id}`);
        } else {
          console.log(`[EXTENDED_MODE] No summarization needed for thread ${extended_thread_id}`);
        }
        
        // Return the request with all messages
        return {
          ...req,
          body: {
            ...req.body,
            messages: processedMessages,
            vector_store_disabled: true, // Disable vector store in extended mode
            executive_first: false // Flag to indicate this is not using executive-first flow
          }
        };
      }
    } catch (error) {
      console.error('Error processing extended mode request:', error);
      throw error;
    }
  }

  /**
   * Process an executive request in extended mode
   * @param {Object} req - The request object
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - The processed request with updated messages
   */
  async processExecutiveRequest(req, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Extract the thread ID from the original request if available
      const originalReq = options.originalReq || {};
      const extended_thread_id = originalReq.body?.extended_thread_id;
      
      if (!extended_thread_id) {
        // If no thread ID, just pass through the request
        return req;
      }
      
      console.log(`[EXTENDED_MODE] Processing executive request for thread ${extended_thread_id}`);
      
      // Get the messages from the request
      const messages = req.messages || [];
      
      // Manage the executive context
      const optimizedMessages = await this.contextManager.manageExecutiveContext(
        extended_thread_id,
        messages
      );
      
      // Update the progress document with the speaker output
      if (req.speaker_output) {
        await this.progressTracker.replaceSectionInProgressDocument(
          extended_thread_id,
          'Current Speaker Output',
          req.speaker_output
        );
      }
      
      // Return the request with the optimized messages
      return {
        ...req,
        messages: optimizedMessages,
        extended_mode: true // Flag to indicate extended mode is active
      };
    } catch (error) {
      console.error('Error processing extended mode executive request:', error);
      // Return the original request if there's an error
      return req;
    }
  }

  /**
   * Process an executive response in extended mode
   * @param {string} threadId - The thread ID
   * @param {Object} response - The executive response
   * @returns {Promise<Object>} - The processed response
   */
  async processExecutiveResponse(threadId, response) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!threadId) {
      return response;
    }

    try {
      console.log(`[EXTENDED_MODE] Processing executive response for thread ${threadId}`);
      
      // Update the progress document with the executive's evaluation
      if (response.action && response.reason) {
        await this.progressTracker.replaceSectionInProgressDocument(
          threadId,
          'Executive Evaluation',
          `Action: ${response.action}\n\nReason: ${response.reason}`
        );
      }
      
      // If there's a knowledge document, add it to the progress document
      if (response.knowledge_document && 
          response.knowledge_document !== 'No additional information' &&
          response.knowledge_document.trim() !== '') {
        await this.progressTracker.replaceSectionInProgressDocument(
          threadId,
          'Knowledge Document',
          response.knowledge_document
        );
      }
      
      return response;
    } catch (error) {
      console.error(`Error processing executive response for thread ${threadId}:`, error);
      return response;
    }
  }

  /**
   * Update the progress document with the final response
   * @param {string} threadId - The thread ID
   * @param {string} response - The final response content
   * @returns {Promise<void>}
   */
  async updateProgressWithResponse(threadId, response) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!threadId) {
      return;
    }

    try {
      console.log(`[EXTENDED_MODE] Updating progress document with final response for thread ${threadId}`);
      
      // Add the response to the progress document
      await this.progressTracker.replaceSectionInProgressDocument(
        threadId,
        'Final Response',
        response
      );
    } catch (error) {
      console.error(`Error updating progress with response for thread ${threadId}:`, error);
    }
  }

  /**
   * Get all active threads
   * @returns {Promise<Array>} - Array of thread objects
   */
  async getAllThreads() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.threadManager.getAllThreads();
    } catch (error) {
      console.error('Error getting all threads:', error);
      return [];
    }
  }

  /**
   * Get a thread by ID
   * @param {string} threadId - The thread ID
   * @returns {Promise<Object|null>} - The thread object or null if not found
   */
  async getThread(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.threadManager.getOrCreateThread(threadId);
    } catch (error) {
      console.error(`Error getting thread ${threadId}:`, error);
      return null;
    }
  }

  /**
   * Get the progress document for a thread
   * @param {string} threadId - The thread ID
   * @returns {Promise<string|null>} - The progress document content or null if not found
   */
  async getProgressDocument(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return await this.progressTracker.getProgressDocument(threadId);
    } catch (error) {
      console.error(`Error getting progress document for thread ${threadId}:`, error);
      return null;
    }
  }

  /**
   * Delete a thread and all associated data
   * @param {string} threadId - The thread ID
   * @returns {Promise<boolean>} - True if the thread was deleted
   */
  async deleteThread(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Delete the progress document
      await this.progressTracker.deleteProgressDocument(threadId);
      
      // Delete the thread
      return await this.threadManager.deleteThread(threadId);
    } catch (error) {
      console.error(`Error deleting thread ${threadId}:`, error);
      return false;
    }
  }

  /**
   * Close the ExtendedMode and all its components
   */
  async close() {
    try {
      await this.contextManager.close();
      await this.progressTracker.close();
      await this.threadManager.close();
      
      this.initialized = false;
      console.log('ExtendedMode closed');
    } catch (error) {
      console.error('Error closing ExtendedMode:', error);
    }
  }
}

export default ExtendedMode;