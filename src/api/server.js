require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { handleChatCompletion } = require('./chat');
const { handleEmbedding } = require('./embedding');

const app = express();
app.use(express.json());

// Default configuration from environment variables
const PORT = process.env.API_PORT || 3000;
const SPEAKER_URL = process.env.SPEAKER_URL || 'http://speaker:8000';
const EXECUTIVE_URL = process.env.EXECUTIVE_URL || 'http://executive:8001';
const VECTOR_STORE_URL = process.env.VECTOR_STORE_URL || 'http://vector_store:8002';

// Default credentials from environment variables
const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || '';
const DEFAULT_SPEAKER_MODEL = process.env.DEFAULT_SPEAKER_MODEL || 'gpt-4o';
const DEFAULT_SPEAKER_MODEL_PROVIDER = process.env.DEFAULT_SPEAKER_MODEL_PROVIDER || 'openai';
const DEFAULT_SPEAKER_API_KEY = process.env.DEFAULT_SPEAKER_API_KEY || '';
const DEFAULT_SPEAKER_API_BASE = process.env.DEFAULT_SPEAKER_API_BASE || '';
const DEFAULT_EXECUTIVE_MODEL = process.env.DEFAULT_EXECUTIVE_MODEL || 'gpt-4o';
const DEFAULT_EXECUTIVE_MODEL_PROVIDER = process.env.DEFAULT_EXECUTIVE_MODEL_PROVIDER || 'openai';
const DEFAULT_EXECUTIVE_API_KEY = process.env.DEFAULT_EXECUTIVE_API_KEY || '';
const DEFAULT_EXECUTIVE_API_BASE = process.env.DEFAULT_EXECUTIVE_API_BASE || '';

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
    // Extract custom configuration headers if present
    const speakerModel = req.headers['x-speaker-model'] || DEFAULT_SPEAKER_MODEL;
    const speakerModelProvider = req.headers['x-speaker-model-provider'] || DEFAULT_SPEAKER_MODEL_PROVIDER;
    const speakerApiKey = req.headers['x-speaker-api-key'] || req.apiKey || DEFAULT_SPEAKER_API_KEY;
    const speakerApiBase = req.headers['x-speaker-api-base'] || DEFAULT_SPEAKER_API_BASE;
    
    const executiveModel = req.headers['x-executive-model'] || DEFAULT_EXECUTIVE_MODEL;
    const executiveModelProvider = req.headers['x-executive-model-provider'] || DEFAULT_EXECUTIVE_MODEL_PROVIDER;
    const executiveApiKey = req.headers['x-executive-api-key'] || req.apiKey || DEFAULT_EXECUTIVE_API_KEY;
    const executiveApiBase = req.headers['x-executive-api-base'] || DEFAULT_EXECUTIVE_API_BASE;
    
    await handleChatCompletion(req, res, {
      speakerUrl: SPEAKER_URL,
      executiveUrl: EXECUTIVE_URL,
      vectorStoreUrl: VECTOR_STORE_URL,
      speakerConfig: {
        model: speakerModel,
        modelProvider: speakerModelProvider,
        apiKey: speakerApiKey,
        apiBase: speakerApiBase
      },
      executiveConfig: {
        model: executiveModel,
        modelProvider: executiveModelProvider,
        apiKey: executiveApiKey,
        apiBase: executiveApiBase
      }
    });
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
    // Extract custom configuration headers if present
    const apiKey = req.apiKey || DEFAULT_API_KEY;
    
    await handleEmbedding(req, res, {
      vectorStoreUrl: VECTOR_STORE_URL,
      apiKey: apiKey
    });
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

// Start the server
app.listen(PORT, () => {
  console.log(`OpenAI-compatible API server running on port ${PORT}`);
  console.log(`Default Speaker Model: ${DEFAULT_SPEAKER_MODEL} (${DEFAULT_SPEAKER_MODEL_PROVIDER})`);
  console.log(`Default Executive Model: ${DEFAULT_EXECUTIVE_MODEL} (${DEFAULT_EXECUTIVE_MODEL_PROVIDER})`);
  console.log(`API keys ${DEFAULT_API_KEY ? 'are' : 'are not'} configured by default`);
  console.log(`Client credentials can be overridden at runtime via headers`);
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