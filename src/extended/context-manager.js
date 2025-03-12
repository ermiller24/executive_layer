import { initChatModel } from "langchain/chat_models/universal";
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

/**
 * ContextManager class for managing context window utilization in extended response mode
 * Handles dynamic summarization and context window management
 */
class ContextManager {
  constructor(options = {}) {
    this.threadManager = options.threadManager;
    this.progressTracker = options.progressTracker;
    this.maxContextSize = options.maxContextSize || 16000; // Default token limit
    this.summarizationThreshold = options.summarizationThreshold || 0.7; // Trigger at 70% utilization
    this.preserveMessageCount = options.preserveMessageCount || 4; // Preserve the last 4 messages
    this.summaryModel = options.summaryModel || 'openai:gpt-3.5-turbo'; // Use a smaller model for summarization
    this.summaryModelKwargs = options.summaryModelKwargs || {};
    this.llm = null;
    this.initialized = false;
  }

  /**
   * Initialize the ContextManager
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize the LLM for summarization
      this.llm = await initChatModel(
        this.summaryModel,
        this.summaryModelKwargs
      );
      
      this.initialized = true;
      console.log('ContextManager initialized successfully');
    } catch (error) {
      console.error('Error initializing ContextManager:', error);
      throw error;
    }
  }

  /**
   * Estimate the token count of a string
   * This is a simple approximation - in production, you'd use a proper tokenizer
   * @param {string} text - The text to estimate tokens for
   * @returns {number} - Estimated token count
   */
  estimateTokenCount(text) {
    if (!text) return 0;
    // Rough approximation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate the token count of a message
   * @param {Object} message - The message object
   * @returns {number} - Estimated token count
   */
  estimateMessageTokenCount(message) {
    // Base tokens for message metadata (role, etc.)
    const baseTokens = 4;
    
    // Content tokens
    const contentTokens = this.estimateTokenCount(message.content);
    
    return baseTokens + contentTokens;
  }

  /**
   * Estimate the token count of an array of messages
   * @param {Array} messages - Array of message objects
   * @returns {number} - Estimated total token count
   */
  estimateMessagesTokenCount(messages) {
    if (!messages || messages.length === 0) return 0;
    
    return messages.reduce((total, message) => {
      return total + this.estimateMessageTokenCount(message);
    }, 0);
  }

  /**
   * Check if summarization is needed based on context utilization
   * @param {Array} messages - Array of message objects
   * @returns {boolean} - True if summarization is needed
   */
  isSummarizationNeeded(messages) {
    if (!messages || messages.length <= this.preserveMessageCount) {
      return false;
    }
    
    const estimatedTokens = this.estimateMessagesTokenCount(messages);
    const utilizationRatio = estimatedTokens / this.maxContextSize;
    
    return utilizationRatio >= this.summarizationThreshold;
  }

  /**
   * Generate a summary of messages
   * @param {Array} messages - Array of message objects to summarize
   * @returns {Promise<string>} - The generated summary
   */
  async generateSummary(messages) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!messages || messages.length === 0) {
      return "No conversation history to summarize.";
    }

    try {
      // Create a system prompt for summarization
      const systemPrompt = `You are a summarization assistant. Your task is to create a concise but comprehensive summary of the following conversation. 
      
Focus on capturing:
1. The main topics discussed
2. Key questions asked
3. Important information provided
4. Decisions or conclusions reached

Your summary should be detailed enough that someone reading it would understand the full context of the conversation without needing to read the original messages.`;

      // Format the conversation for the LLM
      const conversationText = messages.map(msg => {
        return `${msg.role.toUpperCase()}: ${msg.content}`;
      }).join('\n\n');

      // Create the human message with the conversation
      const humanMessage = `Please summarize the following conversation:\n\n${conversationText}`;

      // Generate the summary
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanMessage)
      ]);

      return response.content;
    } catch (error) {
      console.error('Error generating summary:', error);
      // Fallback to a basic summary if LLM fails
      return `Conversation summary (${messages.length} messages): Topics included ${
        messages.slice(0, 3).map(m => m.content.substring(0, 30) + '...').join(', ')
      } and more.`;
    }
  }

  /**
   * Manage the context window by summarizing older messages if needed
   * @param {string} threadId - The ID of the thread
   * @param {Array} messages - Array of message objects
   * @returns {Promise<Array>} - The optimized messages array
   */
  async manageContextWindow(threadId, messages) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!messages || messages.length === 0) {
      return messages;
    }

    try {
      // Check if summarization is needed
      if (!this.isSummarizationNeeded(messages)) {
        return messages;
      }

      console.log(`[CONTEXT_MANAGER] Context window utilization high for thread ${threadId}, summarizing older messages`);

      // Determine which messages to preserve (keep the most recent N messages)
      const preserveCount = Math.min(this.preserveMessageCount, messages.length);
      const messagesToPreserve = messages.slice(-preserveCount);
      const messagesToSummarize = messages.slice(0, -preserveCount);

      // Generate a summary of the older messages
      const summary = await this.generateSummary(messagesToSummarize);

      // Create a summary message
      const summaryMessage = {
        role: 'system',
        content: `[CONVERSATION SUMMARY: ${summary}]`,
        isSummary: true
      };

      // If we have a thread manager, update the thread with the summary
      if (this.threadManager) {
        const startPosition = 0;
        const endPosition = messages.length - preserveCount - 1;
        
        if (startPosition <= endPosition) {
          await this.threadManager.replaceMessagesWithSummary(
            threadId,
            startPosition,
            endPosition,
            summaryMessage.content
          );
        }
      }

      // If we have a progress tracker, update the progress document with the summary
      if (this.progressTracker) {
        await this.progressTracker.addSectionToProgressDocument(
          threadId,
          'Conversation Summary',
          summary
        );
      }

      // Return the optimized messages array
      return [summaryMessage, ...messagesToPreserve];
    } catch (error) {
      console.error(`Error managing context window for thread ${threadId}:`, error);
      // Return the original messages if there's an error
      return messages;
    }
  }

  /**
   * Manage the executive context by replacing history with progress document references
   * @param {string} threadId - The ID of the thread
   * @param {Array} messages - Array of message objects
   * @returns {Promise<Array>} - The optimized messages array
   */
  async manageExecutiveContext(threadId, messages) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!messages || messages.length === 0 || !this.progressTracker) {
      return messages;
    }

    try {
      // Check if summarization is needed
      if (!this.isSummarizationNeeded(messages)) {
        return messages;
      }

      console.log(`[CONTEXT_MANAGER] Executive context window utilization high for thread ${threadId}, replacing with progress document references`);

      // Determine which messages to preserve (keep the most recent N messages)
      const preserveCount = Math.min(this.preserveMessageCount, messages.length);
      const messagesToPreserve = messages.slice(-preserveCount);

      // Generate a reference to the progress document
      const progressReference = await this.progressTracker.generateProgressReference(threadId);

      // Create a reference message
      const referenceMessage = {
        role: 'system',
        content: progressReference,
        isSummary: true
      };

      // Return the optimized messages array
      return [referenceMessage, ...messagesToPreserve];
    } catch (error) {
      console.error(`Error managing executive context for thread ${threadId}:`, error);
      // Return the original messages if there's an error
      return messages;
    }
  }

  /**
   * Close the ContextManager
   */
  async close() {
    this.initialized = false;
    console.log('ContextManager closed');
  }
}

export default ContextManager;