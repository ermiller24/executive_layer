const axios = require('axios');

/**
 * Handles embedding generation requests in an OpenAI-compatible way
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} options - Configuration options
 */
async function handleEmbedding(req, res, options) {
  const { vectorStoreUrl, apiKey } = options;
  
  // Extract request parameters
  const { model, input, encoding_format, user } = req.body;
  
  // Validate required parameters
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
  
  try {
    // Prepare the request to the vector store
    const vectorStoreRequest = {
      text: Array.isArray(input) ? input : [input],
      apiKey: apiKey
    };
    
    // Generate embeddings
    const response = await axios.post(`${vectorStoreUrl}/embed`, vectorStoreRequest);
    
    // Format the response in OpenAI-compatible format
    const embeddings = response.data.embeddings;
    
    const formattedResponse = {
      object: 'list',
      data: embeddings.map((embedding, index) => ({
        object: 'embedding',
        embedding,
        index
      })),
      model: model || 'text-embedding-3-small',
      usage: {
        prompt_tokens: 0, // We don't have exact token counts
        total_tokens: 0
      }
    };
    
    res.json(formattedResponse);
  } catch (error) {
    console.error('Error in embedding generation:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during embedding generation',
        type: 'server_error',
        param: null,
        code: 'internal_server_error'
      }
    });
  }
}

module.exports = { handleEmbedding };