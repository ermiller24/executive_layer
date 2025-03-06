require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { HierarchicalNSW } = require('hnswlib-node');
const { OpenAIEmbeddings } = require('@langchain/openai');

const app = express();
app.use(express.json());

const PORT = process.env.VECTOR_STORE_PORT || 8002;
const VECTOR_DIMENSION = parseInt(process.env.VECTOR_STORE_DIMENSION || '1536');
const VECTOR_STORE_PATH = process.env.VECTOR_STORE_PATH || '/data/vector_store';
const DEFAULT_API_KEY = process.env.SPEAKER_API_KEY; // Default API key from environment

// Ensure the vector store directory exists
if (!fs.existsSync(VECTOR_STORE_PATH)) {
  fs.mkdirSync(VECTOR_STORE_PATH, { recursive: true });
}

// Initialize the vector index
let vectorIndex;
let metadata = [];
const indexPath = path.join(VECTOR_STORE_PATH, 'vector_index.bin');
const metadataPath = path.join(VECTOR_STORE_PATH, 'metadata.json');

// Load or create the vector index
function initializeVectorIndex() {
  try {
    if (fs.existsSync(indexPath) && fs.existsSync(metadataPath)) {
      // Load existing index
      vectorIndex = new HierarchicalNSW('cosine', VECTOR_DIMENSION);
      vectorIndex.readIndex(indexPath);
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      console.log(`Loaded vector index with ${metadata.length} items`);
    } else {
      // Create new index
      vectorIndex = new HierarchicalNSW('cosine', VECTOR_DIMENSION);
      vectorIndex.initIndex(10000); // Max elements
      metadata = [];
      console.log('Created new vector index');
    }
  } catch (error) {
    console.error('Error initializing vector index:', error);
    // Create new index if loading fails
    vectorIndex = new HierarchicalNSW('cosine', VECTOR_DIMENSION);
    vectorIndex.initIndex(10000); // Max elements
    metadata = [];
    console.log('Created new vector index after error');
  }
}

// Save the vector index
function saveVectorIndex() {
  try {
    vectorIndex.writeIndex(indexPath);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    console.log(`Saved vector index with ${metadata.length} items`);
  } catch (error) {
    console.error('Error saving vector index:', error);
  }
}

// Initialize the vector index
initializeVectorIndex();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Create embeddings model with the provided API key or default
function getEmbeddingsModel(apiKey) {
  return new OpenAIEmbeddings({
    openAIApiKey: apiKey || DEFAULT_API_KEY,
    modelName: 'text-embedding-3-small'
  });
}

// Embedding endpoint
app.post('/embed', async (req, res) => {
  try {
    const { text, apiKey } = req.body;
    
    if (!text || !Array.isArray(text)) {
      return res.status(400).json({
        error: 'Text is required and must be an array'
      });
    }
    
    // Create embeddings model with the provided API key or default
    const embeddingsModel = getEmbeddingsModel(apiKey);
    
    // Generate embeddings for each text
    const embeddingArrays = await Promise.all(
      text.map(t => embeddingsModel.embedQuery(t))
    );
    
    res.json({
      embeddings: embeddingArrays,
      dimension: VECTOR_DIMENSION
    });
  } catch (error) {
    console.error('Error generating embedding:', error);
    res.status(500).json({
      error: 'An error occurred during embedding generation'
    });
  }
});

// Store endpoint
app.post('/store', async (req, res) => {
  try {
    const { text, metadata: itemMetadata = {}, apiKey } = req.body;
    
    if (!text) {
      return res.status(400).json({
        error: 'Text is required'
      });
    }
    
    // Create embeddings model with the provided API key or default
    const embeddingsModel = getEmbeddingsModel(apiKey);
    
    // Generate embedding
    const embeddingArray = await embeddingsModel.embedQuery(text);
    
    // Add to vector index
    const index = metadata.length;
    vectorIndex.addPoint(embeddingArray, index);
    
    // Add metadata
    metadata.push({
      text,
      metadata: itemMetadata,
      timestamp: new Date().toISOString()
    });
    
    // Save the index
    saveVectorIndex();
    
    res.json({
      id: index,
      message: 'Item stored successfully'
    });
  } catch (error) {
    console.error('Error storing item:', error);
    res.status(500).json({
      error: 'An error occurred during item storage'
    });
  }
});

// Query endpoint
app.post('/query', async (req, res) => {
  try {
    const { query, top_k = 3, apiKey } = req.body;
    
    if (!query) {
      return res.status(400).json({
        error: 'Query is required'
      });
    }
    
    if (metadata.length === 0) {
      return res.json({
        results: []
      });
    }
    
    // Create embeddings model with the provided API key or default
    const embeddingsModel = getEmbeddingsModel(apiKey);
    
    // Generate embedding for the query
    const queryEmbedding = await embeddingsModel.embedQuery(query);
    
    // Search for similar items
    const k = Math.min(top_k, metadata.length);
    const result = vectorIndex.searchKnn(queryEmbedding, k);
    
    // Format results
    const results = result.neighbors.map((index, i) => ({
      id: index,
      text: metadata[index].text,
      metadata: metadata[index].metadata,
      timestamp: metadata[index].timestamp,
      score: result.distances[i]
    }));
    
    res.json({
      results
    });
  } catch (error) {
    console.error('Error querying items:', error);
    res.status(500).json({
      error: 'An error occurred during query'
    });
  }
});

// Delete endpoint
app.delete('/delete/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id) || id < 0 || id >= metadata.length) {
      return res.status(400).json({
        error: 'Invalid ID'
      });
    }
    
    // Mark the item as deleted in metadata
    metadata[id] = {
      text: '[DELETED]',
      metadata: { deleted: true },
      timestamp: new Date().toISOString()
    };
    
    // Save the index
    saveVectorIndex();
    
    res.json({
      message: 'Item marked as deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({
      error: 'An error occurred during deletion'
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Vector Store service running on port ${PORT}`);
  console.log(`API key ${DEFAULT_API_KEY ? 'is' : 'is not'} configured by default`);
  console.log(`Client API keys can be overridden at runtime`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  saveVectorIndex();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  saveVectorIndex();
  process.exit(0);
});