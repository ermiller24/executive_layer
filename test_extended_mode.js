import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Configuration
const API_URL = process.env.EIR_API_URL || 'http://localhost:3000';
const API_KEY = process.env.EIR_API_KEY || 'dummy-api-key';
const THREAD_ID = 'test-thread-' + Date.now();

// Headers for API requests
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`
};

// Test messages
const messages = [
  {
    role: 'system',
    content: 'You are a helpful assistant that provides detailed information about various topics.'
  },
  {
    role: 'user',
    content: 'Tell me about the solar system. Include details about each planet.'
  }
];

// Follow-up messages
const followUpMessages = [
  {
    role: 'user',
    content: 'Now tell me more about Jupiter specifically. What are its moons like?'
  }
];

// Second follow-up messages
const secondFollowUpMessages = [
  {
    role: 'user',
    content: 'What about Saturn? How do its rings compare to other planets?'
  }
];

/**
 * Make a chat completion request
 * @param {Array} messages - The messages to send
 * @param {string} threadId - The thread ID for extended mode
 * @param {boolean} stream - Whether to stream the response
 * @returns {Promise<Object>} - The response
 */
async function chatCompletion(messages, threadId, stream = false) {
  try {
    const response = await axios.post(
      `${API_URL}/v1/chat/completions`,
      {
        model: 'gpt-4',
        messages,
        extended_thread_id: threadId,
        stream
      },
      { headers }
    );
    
    // Save the response content to a file for debugging
    if (response.data.choices && response.data.choices[0].message) {
      const content = response.data.choices[0].message.content;
      const filename = `response-${threadId}-${Date.now()}.txt`;
      
      fs.writeFile(filename, content)
        .then(() => console.log(`Response content saved to ${filename}`))
        .catch(err => console.error('Error saving response content:', err));
    }
    
    return response.data;
  } catch (error) {
    console.error('Error in chat completion:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Stream a chat completion request
 * @param {Array} messages - The messages to send
 * @param {string} threadId - The thread ID for extended mode
 * @returns {Promise<string>} - The full response content
 */
async function streamChatCompletion(messages, threadId) {
  try {
    const response = await axios.post(
      `${API_URL}/v1/chat/completions`,
      {
        model: 'gpt-4',
        messages,
        extended_thread_id: threadId,
        stream: true
      },
      {
        headers,
        responseType: 'stream'
      }
    );
    
    return new Promise((resolve, reject) => {
      let fullContent = '';
      let rawStreamData = '';
      
      response.data.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        rawStreamData += chunkStr; // Save the raw stream data
        
        const lines = chunkStr.split('\n\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.substring(6));
              
              if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                const content = data.choices[0].delta.content;
                process.stdout.write(content);
                fullContent += content;
              }
            } catch (error) {
              // Ignore parsing errors for non-JSON lines
            }
          }
        }
      });
      
      response.data.on('end', () => {
        console.log('\n\n[Stream ended]\n');
        
        // Save the raw stream data to a file
        const rawStreamFilename = `stream-raw-${threadId}.json`;
        fs.writeFile(rawStreamFilename, rawStreamData)
          .then(() => console.log(`Raw stream data saved to ${rawStreamFilename}`))
          .catch(err => console.error('Error saving raw stream data:', err));
        
        // Save the full content to a file
        const contentFilename = `stream-content-${threadId}.txt`;
        fs.writeFile(contentFilename, fullContent)
          .then(() => console.log(`Stream content saved to ${contentFilename}`))
          .catch(err => console.error('Error saving stream content:', err));
        
        resolve(fullContent);
      });
      
      response.data.on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    console.error('Error in streaming chat completion:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get the progress document for a thread
 * @param {string} threadId - The thread ID
 * @returns {Promise<Object>} - The progress document
 */
async function getProgressDocument(threadId) {
  try {
    const response = await axios.get(
      `${API_URL}/v1/extended/progress/${threadId}`,
      { headers }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error getting progress document:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * List all active threads
 * @returns {Promise<Object>} - The list of threads
 */
async function listThreads() {
  try {
    const response = await axios.get(
      `${API_URL}/v1/extended/threads`,
      { headers }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error listing threads:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Delete a thread
 * @param {string} threadId - The thread ID
 * @returns {Promise<Object>} - The response
 */
async function deleteThread(threadId) {
  try {
    const response = await axios.delete(
      `${API_URL}/v1/extended/threads/${threadId}`,
      { headers }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error deleting thread:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Save the progress document to a file
 * @param {string} threadId - The thread ID
 * @param {Object} progressDoc - The progress document
 */
async function saveProgressDocument(threadId, progressDoc) {
  try {
    const filename = `progress-${threadId}.md`;
    await fs.writeFile(filename, progressDoc.progress_document);
    console.log(`Progress document saved to ${filename}`);
  } catch (error) {
    console.error('Error saving progress document:', error);
  }
}

/**
 * Run the extended mode test
 */
async function runTest() {
  try {
    console.log(`\n=== Testing Extended Mode with Thread ID: ${THREAD_ID} ===\n`);
    
    // Initial request
    console.log('Sending initial request...');
    const initialResponse = await chatCompletion(messages, THREAD_ID);
    console.log(`\nInitial response received (${initialResponse.choices[0].message.content.length} chars)`);
    console.log('Content:', initialResponse.choices[0].message.content.substring(0, 100) + '...');
    
    // Get the progress document
    console.log('\nGetting progress document...');
    const progressDoc1 = await getProgressDocument(THREAD_ID);
    console.log('Progress document retrieved:', progressDoc1.progress_document.substring(0, 100) + '...');
    await saveProgressDocument(THREAD_ID, progressDoc1);
    
    // Follow-up request
    console.log('\nSending follow-up request...');
    const followUpResponse = await chatCompletion(followUpMessages, THREAD_ID);
    console.log(`\nFollow-up response received (${followUpResponse.choices[0].message.content.length} chars)`);
    console.log('Content:', followUpResponse.choices[0].message.content.substring(0, 100) + '...');
    
    // Get the updated progress document
    console.log('\nGetting updated progress document...');
    const progressDoc2 = await getProgressDocument(THREAD_ID);
    console.log('Updated progress document retrieved:', progressDoc2.progress_document.substring(0, 100) + '...');
    await saveProgressDocument(THREAD_ID, progressDoc2);
    
    // Second follow-up request with streaming
    console.log('\nSending second follow-up request with streaming...');
    const streamContent = await streamChatCompletion(secondFollowUpMessages, THREAD_ID);
    console.log(`\nStreaming response received (${streamContent.length} chars)`);
    
    // Get the final progress document
    console.log('\nGetting final progress document...');
    const progressDoc3 = await getProgressDocument(THREAD_ID);
    console.log('Final progress document retrieved:', progressDoc3.progress_document.substring(0, 100) + '...');
    await saveProgressDocument(THREAD_ID, progressDoc3);
    
    // List all threads
    console.log('\nListing all threads...');
    const threads = await listThreads();
    console.log(`Found ${threads.count} threads`);
    
    // Delete the test thread
    console.log('\nDeleting test thread...');
    const deleteResponse = await deleteThread(THREAD_ID);
    console.log('Thread deleted:', deleteResponse);
    
    console.log('\n=== Extended Mode Test Completed Successfully ===\n');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest();