import fs from 'fs/promises';
import path from 'path';

/**
 * ProgressTracker class for managing progress documents in extended response mode
 * Handles document creation, updating, and reading
 */
class ProgressTracker {
  constructor(options = {}) {
    this.threadManager = options.threadManager;
    this.progressDir = options.progressDir || './data/progress';
    this.initialized = false;
  }

  /**
   * Initialize the ProgressTracker
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Ensure the progress directory exists
      await fs.mkdir(this.progressDir, { recursive: true });
      this.initialized = true;
      console.log('ProgressTracker initialized successfully');
    } catch (error) {
      console.error('Error initializing ProgressTracker:', error);
      throw error;
    }
  }

  /**
   * Create or update a progress document for a thread
   * @param {string} threadId - The ID of the thread
   * @param {string} content - The document content
   * @returns {Promise<string>} - The path to the progress document
   */
  async updateProgressDocument(threadId, content) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // If we have a thread manager, update the document in the database
      if (this.threadManager) {
        await this.threadManager.updateProgressDocument(threadId, content);
      }

      // Also save to the file system for backup and direct access
      const docPath = path.join(this.progressDir, `${threadId}.md`);
      await fs.writeFile(docPath, content, 'utf8');
      
      return docPath;
    } catch (error) {
      console.error(`Error updating progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get the progress document for a thread
   * @param {string} threadId - The ID of the thread
   * @returns {Promise<string|null>} - The document content or null if not found
   */
  async getProgressDocument(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // First try to get from the thread manager if available
      if (this.threadManager) {
        const doc = await this.threadManager.getProgressDocument(threadId);
        if (doc) {
          return doc;
        }
      }

      // Fall back to the file system
      const docPath = path.join(this.progressDir, `${threadId}.md`);
      try {
        return await fs.readFile(docPath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null; // File doesn't exist
        }
        throw error;
      }
    } catch (error) {
      console.error(`Error getting progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Append to a progress document for a thread
   * @param {string} threadId - The ID of the thread
   * @param {string} content - The content to append
   * @returns {Promise<string>} - The path to the progress document
   */
  async appendToProgressDocument(threadId, content) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Get the current document
      const currentDoc = await this.getProgressDocument(threadId) || '';
      
      // Append the new content
      const updatedDoc = currentDoc + '\n\n' + content;
      
      // Update the document
      return await this.updateProgressDocument(threadId, updatedDoc);
    } catch (error) {
      console.error(`Error appending to progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new section in a progress document
   * @param {string} threadId - The ID of the thread
   * @param {string} sectionTitle - The title of the section
   * @param {string} content - The content of the section
   * @returns {Promise<string>} - The path to the progress document
   */
  async addSectionToProgressDocument(threadId, sectionTitle, content) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Get the current document
      const currentDoc = await this.getProgressDocument(threadId) || '';
      
      // Add the new section
      const section = `\n\n## ${sectionTitle}\n\n${content}`;
      const updatedDoc = currentDoc + section;
      
      // Update the document
      return await this.updateProgressDocument(threadId, updatedDoc);
    } catch (error) {
      console.error(`Error adding section to progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Replace a section in a progress document
   * @param {string} threadId - The ID of the thread
   * @param {string} sectionTitle - The title of the section to replace
   * @param {string} content - The new content of the section
   * @returns {Promise<string>} - The path to the progress document
   */
  async replaceSectionInProgressDocument(threadId, sectionTitle, content) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      console.log(`[PROGRESS_TRACKER] Replacing section "${sectionTitle}" in progress document for thread ${threadId}`);
      console.log(`[PROGRESS_TRACKER] New content length: ${content.length} chars`);
      
      // Get the current document
      const currentDoc = await this.getProgressDocument(threadId) || '';
      console.log(`[PROGRESS_TRACKER] Current document length: ${currentDoc.length} chars`);
      
      // Check if the section exists
      // This regex looks for the section title followed by content up to the next section or end of document
      const sectionRegex = new RegExp(`## ${sectionTitle}\\s*\\n\\s*([\\s\\S]*?)(?=\\s*\\n\\s*## |$)`, 'i');
      const sectionMatch = currentDoc.match(sectionRegex);
      
      let updatedDoc;
      if (sectionMatch) {
        console.log(`[PROGRESS_TRACKER] Found existing section "${sectionTitle}"`);
        // Replace the existing section
        updatedDoc = currentDoc.replace(
          sectionRegex,
          `## ${sectionTitle}\n\n${content}`
        );
      } else {
        console.log(`[PROGRESS_TRACKER] Section "${sectionTitle}" not found, adding as new section`);
        // Add as a new section
        updatedDoc = currentDoc + `\n\n## ${sectionTitle}\n\n${content}`;
      }
      
      console.log(`[PROGRESS_TRACKER] Updated document length: ${updatedDoc.length} chars`);
      
      // Update the document
      const result = await this.updateProgressDocument(threadId, updatedDoc);
      console.log(`[PROGRESS_TRACKER] Successfully updated progress document for thread ${threadId}`);
      return result;
    } catch (error) {
      console.error(`[PROGRESS_TRACKER] Error replacing section in progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific section from a progress document
   * @param {string} threadId - The ID of the thread
   * @param {string} sectionTitle - The title of the section to get
   * @returns {Promise<string|null>} - The section content or null if not found
   */
  async getSectionFromProgressDocument(threadId, sectionTitle) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Get the current document
      const currentDoc = await this.getProgressDocument(threadId);
      if (!currentDoc) {
        return null;
      }
      
      // Extract the section
      const sectionRegex = new RegExp(`## ${sectionTitle}\\n\\n([\\s\\S]*?)(?=\\n\\n## |$)`, 'i');
      const sectionMatch = currentDoc.match(sectionRegex);
      
      if (sectionMatch && sectionMatch[1]) {
        return sectionMatch[1].trim();
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting section from progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a progress document
   * @param {string} threadId - The ID of the thread
   * @returns {Promise<boolean>} - True if the document was deleted, false if it didn't exist
   */
  async deleteProgressDocument(threadId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let deleted = false;
      
      // Delete from the thread manager if available
      if (this.threadManager) {
        try {
          // This will fail silently if the document doesn't exist
          await this.threadManager.updateProgressDocument(threadId, '');
        } catch (error) {
          console.warn(`Error deleting progress document from thread manager for thread ${threadId}:`, error);
        }
      }
      
      // Delete from the file system
      const docPath = path.join(this.progressDir, `${threadId}.md`);
      try {
        await fs.unlink(docPath);
        deleted = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      return deleted;
    } catch (error) {
      console.error(`Error deleting progress document for thread ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Generate a reference to the progress document that can be included in messages
   * @param {string} threadId - The ID of the thread
   * @param {string} sectionTitle - Optional section title to reference
   * @returns {Promise<string>} - A formatted reference to the progress document
   */
  async generateProgressReference(threadId, sectionTitle = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      let reference = `[Progress Document Reference: Thread ${threadId}]`;
      
      if (sectionTitle) {
        const sectionContent = await this.getSectionFromProgressDocument(threadId, sectionTitle);
        if (sectionContent) {
          reference += `\n\n## ${sectionTitle}\n\n${sectionContent}`;
        } else {
          reference += `\n\nSection "${sectionTitle}" not found.`;
        }
      } else {
        const doc = await this.getProgressDocument(threadId);
        if (doc) {
          reference += `\n\n${doc}`;
        } else {
          reference += `\n\nNo progress document found.`;
        }
      }
      
      return reference;
    } catch (error) {
      console.error(`Error generating progress reference for thread ${threadId}:`, error);
      return `[Error retrieving progress document for thread ${threadId}]`;
    }
  }

  /**
   * Close the ProgressTracker
   */
  async close() {
    this.initialized = false;
    console.log('ProgressTracker closed');
  }
}

export default ProgressTracker;