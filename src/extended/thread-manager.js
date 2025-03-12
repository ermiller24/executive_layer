import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import path from 'path';

/**
 * ThreadManager class for managing conversation threads in extended response mode
 * Handles thread storage, retrieval, updating, and cleanup using SQLite
 */
class ThreadManager {
  constructor(options = {}) {
    this.dbPath = options.dbPath || './data/threads.db';
    this.db = null;
    this.initialized = false;
    this.expirationTime = options.expirationTime || 24 * 60 * 60 * 1000; // Default: 24 hours
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // Default: 1 hour
    this.cleanupTimer = null;
  }

  /**
   * Initialize the ThreadManager and database
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure the directory exists
      const dbDir = path.dirname(this.dbPath);
      await fs.mkdir(dbDir, { recursive: true });

      // Open the database
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Create tables if they don't exist
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          thread_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          last_accessed INTEGER NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 0,
          metadata TEXT
        );
        
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          position INTEGER NOT NULL,
          is_summary BOOLEAN NOT NULL DEFAULT 0,
          FOREIGN KEY (thread_id) REFERENCES threads (thread_id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS progress_documents (
          thread_id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          last_updated INTEGER NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads (thread_id) ON DELETE CASCADE
        );
      `);

      // Start the cleanup timer
      this.startCleanupTimer();

      this.initialized = true;
      console.log('ThreadManager initialized successfully');
    } catch (error) {
      console.error('Error initializing ThreadManager:', error);
      throw error;
    }
  }

  /**
   * Start the cleanup timer to periodically remove expired threads
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredThreads()
        .catch(error => console.error('Error during thread cleanup:', error));
    }, this.cleanupInterval);
  }

  /**
   * Clean up expired threads
   */
  async cleanupExpiredThreads() {
    if (!this.initialized || !this.db) {
      return;
    }

    try {
      const expirationThreshold = Date.now() - this.expirationTime;
      
      // Get the list of expired thread IDs
      const expiredThreads = await this.db.all(
        'SELECT thread_id FROM threads WHERE last_accessed < ?',
        expirationThreshold
      );
      
      if (expiredThreads.length === 0) {
        return;
      }
      
      console.log(`Cleaning up ${expiredThreads.length} expired threads`);
      
      // Delete the expired threads
      // Cascade will automatically delete associated messages and progress documents
      for (const thread of expiredThreads) {
        await this.db.run(
          'DELETE FROM threads WHERE thread_id = ?',
          thread.thread_id
        );
      }
      
      console.log(`Cleaned up ${expiredThreads.length} expired threads`);
    } catch (error) {
      console.error('Error cleaning up expired threads:', error);
    }
  }

  /**
   * Create a new thread or retrieve an existing one
   * @param {string} threadId - The ID of the thread
   * @param {Object} metadata - Optional metadata for the thread
   * @returns {Promise<Object>} - The thread object
   */
  async getOrCreateThread(threadId, metadata = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Check if the thread exists
      const thread = await this.db.get(
        'SELECT * FROM threads WHERE thread_id = ?',
        threadId
      );

      const now = Date.now();

      if (thread) {
        // Update the last accessed time
        await this.db.run(
          'UPDATE threads SET last_accessed = ? WHERE thread_id = ?',
          now, threadId
        );

        // Get the messages for this thread
        const messages = await this.getThreadMessages(threadId);

        return {
          threadId: thread.thread_id,
          createdAt: thread.created_at,
          lastAccessed: now,
          messageCount: thread.message_count,
          metadata: JSON.parse(thread.metadata || '{}'),
          messages
        };
      } else {
        // Create a new thread
        const metadataJson = JSON.stringify(metadata || {});
        
        await this.db.run(
          'INSERT INTO threads (thread_id, created_at, last_accessed, message_count, metadata) VALUES (?, ?, ?, 0, ?)',
          threadId, now, now, metadataJson
        );

        return {
          threadId,
          createdAt: now,
          lastAccessed: now,
          messageCount: 0,
          metadata: metadata || {},
          messages: []
        };
      }
    } catch (error) {
      console.error(`Error getting or creating thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get all messages for a thread
   * @param {string} threadId - The ID of the thread
   * @returns {Promise<Array>} - Array of message objects
   */
  async getThreadMessages(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const messages = await this.db.all(
        'SELECT * FROM messages WHERE thread_id = ? ORDER BY position ASC',
        threadId
      );

      return messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        position: msg.position,
        isSummary: Boolean(msg.is_summary)
      }));
    } catch (error) {
      console.error(`Error getting messages for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Add messages to a thread
   * @param {string} threadId - The ID of the thread
   * @param {Array} messages - Array of message objects with role and content
   * @returns {Promise<Object>} - The updated thread object
   */
  async addMessagesToThread(threadId, messages) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array');
    }

    try {
      // Get the current thread
      const thread = await this.getOrCreateThread(threadId);
      const now = Date.now();
      
      // Start a transaction
      await this.db.run('BEGIN TRANSACTION');
      
      // Get the current highest position
      const result = await this.db.get(
        'SELECT MAX(position) as maxPosition FROM messages WHERE thread_id = ?',
        threadId
      );
      
      let nextPosition = (result && result.maxPosition !== null) ? result.maxPosition + 1 : 0;
      
      // Insert each message
      for (const message of messages) {
        await this.db.run(
          'INSERT INTO messages (thread_id, role, content, timestamp, position, is_summary) VALUES (?, ?, ?, ?, ?, ?)',
          threadId, message.role, message.content, now, nextPosition, message.isSummary ? 1 : 0
        );
        nextPosition++;
      }
      
      // Update the message count and last accessed time
      await this.db.run(
        'UPDATE threads SET message_count = message_count + ?, last_accessed = ? WHERE thread_id = ?',
        messages.length, now, threadId
      );
      
      // Commit the transaction
      await this.db.run('COMMIT');
      
      // Get the updated thread
      return await this.getOrCreateThread(threadId);
    } catch (error) {
      // Rollback the transaction on error
      await this.db.run('ROLLBACK');
      console.error(`Error adding messages to thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Replace a range of messages with a summary
   * @param {string} threadId - The ID of the thread
   * @param {number} startPosition - The starting position (inclusive)
   * @param {number} endPosition - The ending position (inclusive)
   * @param {string} summary - The summary text
   * @returns {Promise<Object>} - The updated thread object
   */
  async replaceMessagesWithSummary(threadId, startPosition, endPosition, summary) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Start a transaction
      await this.db.run('BEGIN TRANSACTION');
      
      // Delete the messages in the range
      await this.db.run(
        'DELETE FROM messages WHERE thread_id = ? AND position >= ? AND position <= ?',
        threadId, startPosition, endPosition
      );
      
      // Insert the summary at the start position
      const now = Date.now();
      await this.db.run(
        'INSERT INTO messages (thread_id, role, content, timestamp, position, is_summary) VALUES (?, ?, ?, ?, ?, 1)',
        threadId, 'system', summary, now, startPosition
      );
      
      // Update positions for messages after the range
      await this.db.run(
        `UPDATE messages 
         SET position = position - (? - ? - 1) 
         WHERE thread_id = ? AND position > ?`,
        endPosition, startPosition, threadId, endPosition
      );
      
      // Update the message count
      const deletedCount = endPosition - startPosition + 1;
      await this.db.run(
        'UPDATE threads SET message_count = message_count - ? + 1, last_accessed = ? WHERE thread_id = ?',
        deletedCount, now, threadId
      );
      
      // Commit the transaction
      await this.db.run('COMMIT');
      
      // Get the updated thread
      return await this.getOrCreateThread(threadId);
    } catch (error) {
      // Rollback the transaction on error
      await this.db.run('ROLLBACK');
      console.error(`Error replacing messages with summary in thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get the progress document for a thread
   * @param {string} threadId - The ID of the thread
   * @returns {Promise<string|null>} - The progress document content or null if not found
   */
  async getProgressDocument(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const doc = await this.db.get(
        'SELECT content FROM progress_documents WHERE thread_id = ?',
        threadId
      );
      
      return doc ? doc.content : null;
    } catch (error) {
      console.error(`Error getting progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Update the progress document for a thread
   * @param {string} threadId - The ID of the thread
   * @param {string} content - The document content
   * @returns {Promise<void>}
   */
  async updateProgressDocument(threadId, content) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const now = Date.now();
      
      // Check if the document exists
      const doc = await this.db.get(
        'SELECT 1 FROM progress_documents WHERE thread_id = ?',
        threadId
      );
      
      if (doc) {
        // Update existing document
        await this.db.run(
          'UPDATE progress_documents SET content = ?, last_updated = ? WHERE thread_id = ?',
          content, now, threadId
        );
      } else {
        // Create new document
        await this.db.run(
          'INSERT INTO progress_documents (thread_id, content, last_updated) VALUES (?, ?, ?)',
          threadId, content, now
        );
      }
      
      // Update the thread's last accessed time
      await this.db.run(
        'UPDATE threads SET last_accessed = ? WHERE thread_id = ?',
        now, threadId
      );
    } catch (error) {
      console.error(`Error updating progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a thread and all associated data
   * @param {string} threadId - The ID of the thread
   * @returns {Promise<boolean>} - True if the thread was deleted, false if it didn't exist
   */
  async deleteThread(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Check if the thread exists
      const thread = await this.db.get(
        'SELECT 1 FROM threads WHERE thread_id = ?',
        threadId
      );
      
      if (!thread) {
        return false;
      }
      
      // Delete the thread (cascade will delete messages and progress documents)
      await this.db.run(
        'DELETE FROM threads WHERE thread_id = ?',
        threadId
      );
      
      return true;
    } catch (error) {
      console.error(`Error deleting thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get all active threads
   * @returns {Promise<Array>} - Array of thread objects without messages
   */
  async getAllThreads() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const threads = await this.db.all('SELECT * FROM threads');
      
      return threads.map(thread => ({
        threadId: thread.thread_id,
        createdAt: thread.created_at,
        lastAccessed: thread.last_accessed,
        messageCount: thread.message_count,
        metadata: JSON.parse(thread.metadata || '{}')
      }));
    } catch (error) {
      console.error('Error getting all threads:', error);
      throw error;
    }
  }

  /**
   * Close the ThreadManager and database connection
   */
  async close() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    this.initialized = false;
    console.log('ThreadManager closed');
  }
}

export default ThreadManager;