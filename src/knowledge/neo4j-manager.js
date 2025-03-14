/**
 * Neo4j Knowledge Graph Manager
 * Handles all interactions with the Neo4j database for the EIR system
 */

import neo4j from 'neo4j-driver';
import { pipeline } from '@huggingface/transformers';

class Neo4jManager {
  /**
   * Initialize the Neo4j manager
   * @param {string} url - Neo4j connection URL
   * @param {string} user - Neo4j username
   * @param {string} password - Neo4j password
   * @param {string} embeddingModel - Hugging Face model name for embeddings
   * @param {number} embeddingDimension - Dimension of the embedding vectors
   */
  constructor(url, user, password, embeddingModel = 'sentence-transformers/all-MiniLM-L6-v2', embeddingDimension = 384) {
    this.driver = neo4j.driver(
      url,
      neo4j.auth.basic(user, password)
    );
    this.session = this.driver.session();
    this.embeddingModel = embeddingModel;
    this.embeddingDimension = embeddingDimension;
    this.embeddingPipeline = null;
  }

  /**
   * Initialize the embedding pipeline
   * @returns {Promise<void>}
   */
  async initializeEmbeddingPipeline() {
    if (!this.embeddingPipeline) {
      try {
        console.log(`Initializing embedding pipeline with model: ${this.embeddingModel}`);
        
        // Create the pipeline with detailed options for @huggingface/transformers v3.4.0
        this.embeddingPipeline = await pipeline('feature-extraction', this.embeddingModel);
        
        // Test the pipeline with a simple example
        console.log('Testing embedding pipeline with a simple example...');
        const testText = 'This is a test sentence for embedding generation.';
        const testOutput = await this.embeddingPipeline(testText);
        
        console.log('Test embedding output type:', typeof testOutput);
        console.log('Test embedding output is array:', Array.isArray(testOutput));
        
        if (Array.isArray(testOutput)) {
          console.log('Embedding array length:', testOutput.length);
          if (testOutput.length > 0) {
            console.log('First element type:', typeof testOutput[0]);
            console.log('Is first element array:', Array.isArray(testOutput[0]));
            if (Array.isArray(testOutput[0])) {
              console.log('First inner array length:', testOutput[0].length);
              console.log('First few values:', testOutput[0].slice(0, 5));
            }
          }
        } else if (testOutput && typeof testOutput === 'object') {
          console.log('Embedding output keys:', Object.keys(testOutput));
        }
        
        console.log(`Embedding pipeline initialized successfully with model: ${this.embeddingModel}`);
      } catch (error) {
        console.error('Failed to initialize embedding pipeline:', error);
        console.error('Error details:', error.stack);
        throw error;
      }
    }
  }

  /**
   * Generate embeddings for a text string
   * @param {string} text - The text to generate embeddings for
   * @returns {Promise<number[]>} - The embedding vector
   */
  async generateEmbedding(text) {
    await this.initializeEmbeddingPipeline();
    
    try {
      console.log(`Generating embedding for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      // Generate embedding using the pipeline
      const output = await this.embeddingPipeline(text);
      
      // Log the raw output structure to understand what we're getting
      console.log('Raw embedding output type:', typeof output);
      console.log('Raw embedding output is array:', Array.isArray(output));
      
      // Extract the embedding vector from the output
      let embedding = null;
      
      // Handle Tensor object from @huggingface/transformers v3.4.0
      if (output && typeof output === 'object' && output.ort_tensor && output.ort_tensor.cpuData) {
        console.log('Found Tensor object with cpuData');
        console.log('Tensor dimensions:', output.ort_tensor.dims);
        console.log('Tensor size:', output.ort_tensor.size);
        
        // Extract the Float32Array from the tensor
        const tensorData = output.ort_tensor.cpuData;
        console.log('Tensor data type:', tensorData.constructor.name);
        console.log('Tensor data length:', tensorData.length);
        
        // The tensor has dimensions [1, numTokens, embeddingDim]
        // We need to average across tokens to get a single embedding vector
        const dims = output.ort_tensor.dims;
        const batchSize = dims[0];
        const numTokens = dims[1];
        const embeddingDim = dims[2];
        
        console.log(`Tensor structure: [${batchSize}, ${numTokens}, ${embeddingDim}]`);
        
        // Create an array to hold the averaged embedding
        const averagedEmbedding = new Array(embeddingDim).fill(0);
        
        // Sum up the embeddings for all tokens
        for (let tokenIdx = 0; tokenIdx < numTokens; tokenIdx++) {
          for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
            // Calculate the index in the flattened array
            // For a tensor with dims [1, numTokens, embeddingDim], the index is:
            // batchIdx * (numTokens * embeddingDim) + tokenIdx * embeddingDim + dimIdx
            const flatIndex = tokenIdx * embeddingDim + dimIdx;
            averagedEmbedding[dimIdx] += tensorData[flatIndex];
          }
        }
        
        // Divide by the number of tokens to get the average
        for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
          averagedEmbedding[dimIdx] /= numTokens;
        }
        
        embedding = averagedEmbedding;
        console.log('Created averaged embedding across all tokens');
      } else if (Array.isArray(output)) {
        // Handle array output
        if (output.length > 0) {
          if (Array.isArray(output[0])) {
            console.log('Extracting embedding from output[0] (array of arrays)');
            embedding = output[0];
          } else {
            console.log('Using output directly as embedding (flat array)');
            embedding = output;
          }
        }
      } else if (output && typeof output === 'object') {
        // For other object structures, try to find arrays in the object
        console.log('Searching for embedding in object properties');
        
        if (output.hasOwnProperty('data')) {
          console.log('Extracting embedding from output.data');
          embedding = output.data;
        } else if (output.hasOwnProperty('embeddings')) {
          console.log('Extracting embedding from output.embeddings[0]');
          embedding = output.embeddings[0];
        }
      }
      
      // If we still don't have an embedding, throw an error
      if (!embedding) {
        console.error('Failed to extract embedding vector from output:', output);
        throw new Error('Failed to extract embedding vector');
      }
      
      // Log the embedding details
      console.log(`Raw embedding length: ${embedding.length}`);
      console.log(`Raw embedding sample (first 5 values): [${embedding.slice(0, 5).join(', ')}]`);
      
      // Check for null or undefined values
      const hasNullValues = embedding.some(value => value === null || value === undefined);
      if (hasNullValues) {
        console.warn('Warning: Embedding contains null or undefined values');
        // Replace null values with 0
        embedding = embedding.map(value => (value === null || value === undefined) ? 0 : value);
      }
      
      // Convert all values to numbers and check for NaN
      embedding = embedding.map(value => {
        const num = Number(value);
        if (isNaN(num)) {
          console.warn(`Warning: Found NaN value in embedding, replacing with 0`);
          return 0;
        }
        return num;
      });
      
      // Verify the embedding dimension
      if (embedding.length !== this.embeddingDimension) {
        console.warn(`Warning: Generated embedding dimension (${embedding.length}) does not match expected dimension (${this.embeddingDimension})`);
        
        // If the embedding is too large, truncate it
        if (embedding.length > this.embeddingDimension) {
          console.log(`Truncating embedding from ${embedding.length} to ${this.embeddingDimension} dimensions`);
          embedding = embedding.slice(0, this.embeddingDimension);
        }
        // If the embedding is too small, pad it with zeros
        else if (embedding.length < this.embeddingDimension) {
          console.log(`Padding embedding from ${embedding.length} to ${this.embeddingDimension} dimensions`);
          const padding = new Array(this.embeddingDimension - embedding.length).fill(0);
          embedding = [...embedding, ...padding];
        }
      }
      
      // Log the final embedding size and a sample of values
      console.log(`Final embedding with size: ${embedding.length}`);
      console.log(`Final embedding sample (first 5 values): [${embedding.slice(0, 5).join(', ')}]`);
      
      // Check if all values are 0 or very close to 0
      const allZerosOrSmall = embedding.every(value => Math.abs(value) < 0.0001);
      if (allZerosOrSmall) {
        console.warn('Warning: All embedding values are 0 or very small');
      }
      
      return embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Initialize the Neo4j schema (constraints, indexes, and vector indexes)
   * @returns {Promise<void>}
   */
  async initializeSchema() {
    try {
      // Create constraints
      await this.session.run('CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT knowledge_id IF NOT EXISTS FOR (k:Knowledge) REQUIRE k.id IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_category_name IF NOT EXISTS FOR (tc:TagCategory) REQUIRE tc.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE');
      
      // Create indexes
      await this.session.run('CREATE INDEX topic_name_idx IF NOT EXISTS FOR (t:Topic) ON (t.name)');
      await this.session.run('CREATE INDEX knowledge_id_idx IF NOT EXISTS FOR (k:Knowledge) ON (k.id)');
      await this.session.run('CREATE INDEX tag_category_name_idx IF NOT EXISTS FOR (tc:TagCategory) ON (tc.name)');
      await this.session.run('CREATE INDEX tag_name_idx IF NOT EXISTS FOR (t:Tag) ON (t.name)');
      
      // Create vector indexes for each node type
      try {
        // First check if vector indexes already exist
        const checkQuery = `
          SHOW INDEXES
          WHERE type = 'VECTOR'
        `;
        
        const result = await this.session.run(checkQuery);
        const existingIndexes = new Set(result.records.map(record => record.get('name')));
        
        // Create vector indexes if they don't exist
        const indexesToCreate = [
          { label: 'Topic', property: 'embedding' },
          { label: 'Knowledge', property: 'embedding' },
          { label: 'Tag', property: 'embedding' },
          { label: 'TagCategory', property: 'embedding' }
        ];
        
        for (const { label, property } of indexesToCreate) {
          const indexName = `${label.toLowerCase()}_${property}_idx`;
          if (!existingIndexes.has(indexName)) {
            await this.createVectorIndex(label, property);
          } else {
            console.log(`Vector index ${indexName} already exists`);
          }
        }
      } catch (vectorIndexError) {
        console.error('Failed to create vector indexes:', vectorIndexError);
        // Continue with schema initialization even if vector index creation fails
      }
      
      console.log('Neo4j schema initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Neo4j schema:', error);
      throw error;
    }
  }

  /**
   * Create a vector index for a node label and property
   * @param {string} label - The node label
   * @param {string} property - The property name that will store the vector
   * @returns {Promise<void>}
   */
  async createVectorIndex(label, property) {
    try {
      const indexName = `${label.toLowerCase()}_${property}_idx`;
      
      // Create the vector index with simplified syntax for Neo4j 5.26
      // This works with the free version of Neo4j
      const createQuery = `
        CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
        FOR (n:${label}) ON (n.${property})
        OPTIONS {
          indexConfig: {
            \`vector.dimensions\`: 384,
            \`vector.similarity_function\`: 'cosine'
          }
        }
      `;
      
      await this.session.run(createQuery);
      console.log(`Vector index ${indexName} created successfully`);
    } catch (error) {
      console.error(`Failed to create vector index for ${label}.${property}:`, error);
      throw error;
    }
  }

  /**
   * Set the embedding vector for a node
   * @param {number} nodeId - The ID of the node
   * @param {number[]} embedding - The embedding vector
   * @returns {Promise<void>}
   */
  async setNodeEmbedding(nodeId, embedding) {
    try {
      // Log the embedding structure for debugging
      console.log(`Setting embedding for node ${nodeId}, embedding type: ${typeof embedding}, is array: ${Array.isArray(embedding)}, length: ${embedding.length}`);
      
      // Ensure the embedding is a flat array of numbers
      if (Array.isArray(embedding)) {
        // If embedding is a nested array, flatten it
        if (embedding.some(item => Array.isArray(item))) {
          console.log('Flattening nested embedding array');
          embedding = embedding.flat();
        }
        
        // Convert all values to numbers
        embedding = embedding.map(value => Number(value));
        
        // Verify the embedding dimension
        if (embedding.length !== this.embeddingDimension) {
          console.warn(`Warning: Embedding dimension (${embedding.length}) does not match expected dimension (${this.embeddingDimension})`);
          
          // If the embedding is too large, truncate it
          if (embedding.length > this.embeddingDimension) {
            console.log(`Truncating embedding from ${embedding.length} to ${this.embeddingDimension} dimensions`);
            embedding = embedding.slice(0, this.embeddingDimension);
          }
          // If the embedding is too small, pad it with zeros
          else if (embedding.length < this.embeddingDimension) {
            console.log(`Padding embedding from ${embedding.length} to ${this.embeddingDimension} dimensions`);
            const padding = new Array(this.embeddingDimension - embedding.length).fill(0);
            embedding = [...embedding, ...padding];
          }
        }
      } else {
        console.error('Invalid embedding format:', embedding);
        throw new Error('Invalid embedding format');
      }
      
      // Use a simple SET operation to set the embedding property
      // This is compatible with the free version of Neo4j
      const query = `
        MATCH (n)
        WHERE id(n) = $nodeId
        SET n.embedding = $embedding
      `;
      
      await this.session.run(query, { nodeId, embedding });
      console.log(`Embedding set for node with ID ${nodeId}`);
    } catch (error) {
      console.error(`Failed to set embedding for node with ID ${nodeId}:`, error);
      throw error;
    }
  }

  /**
   * Create a node in the knowledge graph
   * @param {string} nodeType - The type of node to create (tag_category, tag, topic, knowledge, file)
   * @param {string} name - The name of the node (must be unique within its type)
   * @param {string} description - A description of the node
   * @param {Array<{type: string, name: string}>} belongsTo - Optional array of nodes this node belongs to
   * @param {string} path - Optional path for file nodes
   * @param {Object} additionalFields - Optional additional fields for the node
   * @returns {Promise<number>} - The created node's ID
   */
  async createNode(
    nodeType,
    name,
    description,
    belongsTo,
    path,
    additionalFields
  ) {
    try {
      // Convert nodeType to Neo4j label format (e.g., tag_category -> TagCategory)
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Prepare properties based on node type
      const properties = {
        name,
        description,
        ...(additionalFields || {})
      };
      
      // Add path for file nodes
      if (nodeType === 'file' && path) {
        properties.path = path;
      }
      
      // For knowledge nodes, ensure they have a summary
      if (nodeType === 'knowledge' && !properties.summary) {
        properties.summary = name;
      }
      
      // Create the node
      const createQuery = `
        CREATE (n:${label})
        SET n = $properties
        RETURN id(n) as nodeId
      `;
      
      const createResult = await this.session.run(createQuery, { properties });
      const nodeId = createResult.records[0].get('nodeId').toNumber();
      
      // Generate and set embedding for the node name
      try {
        const embedding = await this.generateEmbedding(name);
        await this.setNodeEmbedding(nodeId, embedding);
      } catch (embeddingError) {
        console.error(`Failed to generate or set embedding for node ${name}:`, embeddingError);
        // Continue with node creation even if embedding fails
      }
      
      // Create belongs_to relationships if specified
      if (belongsTo && belongsTo.length > 0) {
        for (const parent of belongsTo) {
          const parentLabel = parent.type.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
          
          const relationshipQuery = `
            MATCH (parent:${parentLabel} {name: $parentName})
            MATCH (child) WHERE id(child) = $childId
            CREATE (child)-[:BELONGS_TO]->(parent)
          `;
          
          await this.session.run(relationshipQuery, {
            parentName: parent.name,
            childId: nodeId
          });
        }
      }
      
      return nodeId;
    } catch (error) {
      console.error(`Failed to create ${nodeType} node:`, error);
      throw error;
    }
  }
  
  /**
   * Create an edge between nodes in the knowledge graph
   * @param {string} sourceType - The type of the source node
   * @param {string|string[]} sourceName - The name of the source node (or array of names)
   * @param {string} targetType - The type of the target node
   * @param {string|string[]} targetName - The name of the target node (or array of names)
   * @param {string} relationship - The type of relationship
   * @param {string} description - A description of the relationship
   * @returns {Promise<number>} - The created edge's ID
   */
  async createEdge(
    sourceType,
    sourceName,
    targetType,
    targetName,
    relationship,
    description
  ) {
    try {
      // Convert types to Neo4j label format
      const sourceLabel = sourceType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      const targetLabel = targetType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Handle arrays of source and target names
      const sourceNames = Array.isArray(sourceName) ? sourceName : [sourceName];
      const targetNames = Array.isArray(targetName) ? targetName : [targetName];
      
      let edgeId = -1;
      
      // Create edges between all sources and targets
      for (const sName of sourceNames) {
        for (const tName of targetNames) {
          const query = `
            MATCH (source:${sourceLabel} {name: $sourceName})
            MATCH (target:${targetLabel} {name: $targetName})
            CREATE (source)-[r:RELATES {relationship: $relationship, description: $description}]->(target)
            RETURN id(r) as edgeId
          `;
          
          const result = await this.session.run(query, {
            sourceName: sName,
            targetName: tName,
            relationship,
            description
          });
          
          // Store the ID of the last created edge
          edgeId = result.records[0].get('edgeId').toNumber();
        }
      }
      
      return edgeId;
    } catch (error) {
      console.error('Failed to create edge:', error);
      throw error;
    }
  }
  
  /**
   * Alter or delete a node in the knowledge graph
   * @param {string} nodeType - The type of node to alter
   * @param {number} nodeId - The ID of the node to alter
   * @param {boolean} deleteNode - Whether to delete the node
   * @param {Object} fields - The fields to update (required if deleteNode is false)
   * @returns {Promise<string>} - Success message
   */
  async alterNode(
    nodeType,
    nodeId,
    deleteNode,
    fields
  ) {
    try {
      // Convert nodeType to Neo4j label format
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      if (deleteNode) {
        // Delete the node
        const query = `
          MATCH (n:${label})
          WHERE id(n) = $nodeId
          DETACH DELETE n
        `;
        
        await this.session.run(query, { nodeId });
        return `Node with ID ${nodeId} deleted successfully`;
      } else if (fields) {
        // Update the node
        const setStatements = Object.entries(fields)
          .map(([key, _]) => `n.${key} = $fields.${key}`)
          .join(', ');
        
        const query = `
          MATCH (n:${label})
          WHERE id(n) = $nodeId
          SET ${setStatements}
          RETURN n
        `;
        
        await this.session.run(query, { nodeId, fields });
        
        // If the name field was updated, regenerate the embedding
        if (fields.name) {
          try {
            const embedding = await this.generateEmbedding(fields.name);
            await this.setNodeEmbedding(nodeId, embedding);
          } catch (embeddingError) {
            console.error(`Failed to update embedding for node with ID ${nodeId}:`, embeddingError);
            // Continue with node update even if embedding update fails
          }
        }
        
        return `Node with ID ${nodeId} updated successfully`;
      } else {
        throw new Error('Either delete must be true or fields must be provided');
      }
    } catch (error) {
      console.error('Failed to alter node:', error);
      throw error;
    }
  }
  
  /**
   * Search the knowledge graph using flexible Cypher query components
   * @param {string} matchClause - The Cypher MATCH clause
   * @param {string} whereClause - Optional Cypher WHERE clause for filtering
   * @param {string} returnClause - The Cypher RETURN clause specifying what to return
   * @param {Object} params - Optional parameters for the query
   * @returns {Promise<string>} - The query results (limited to 20 records)
   */
  async searchGraph(
    matchClause,
    whereClause,
    returnClause,
    params
  ) {
    try {
      let query = `MATCH ${matchClause}`;
      
      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }
      
      query += ` RETURN ${returnClause || matchClause.match(/\(([a-zA-Z0-9_]+)\)/)?.[1] || '*'} LIMIT 20`;
      
      const result = await this.session.run(query, params || {});
      
      // Process the records based on the returned data
      const records = result.records.map(record => {
        const recordObj = {};
        const keys = record.keys.map(key => String(key));
        
        for (const key of keys) {
          const value = record.get(key);
          if (neo4j.isNode(value)) {
            const node = value;
            recordObj[key] = {
              id: node.identity.toNumber(),
              labels: node.labels,
              properties: this.formatNeo4jValue(node.properties)
            };
          } else if (neo4j.isRelationship(value)) {
            const rel = value;
            recordObj[key] = {
              type: rel.type,
              properties: this.formatNeo4jValue(rel.properties),
              start: rel.start.toNumber(),
              end: rel.end.toNumber(),
              identity: rel.identity.toNumber()
            };
          } else {
            recordObj[key] = this.formatNeo4jValue(value);
          }
        }
        return recordObj;
      });
      
      return JSON.stringify(records, null, 2);
    } catch (error) {
      console.error('Failed to search nodes:', error);
      throw error;
    }
  }
  
  /**
   * Execute an arbitrary Cypher query against the Neo4j knowledge graph
   * @param {string} query - The Cypher query to execute
   * @returns {Promise<string>} - The query results (limited to 20 records)
   */
  async executeQuery(query) {
    try {
      const result = await this.session.run(query);
      const records = result.records.map(record => {
        const recordObj = {};
        const keys = record.keys.map(key => String(key));
        
        for (const key of keys) {
          const value = record.get(key);
          if (neo4j.isNode(value)) {
            const node = value;
            recordObj[key] = {
              labels: node.labels,
              properties: this.formatNeo4jValue(node.properties),
              identity: node.identity.toNumber()
            };
          } else if (neo4j.isRelationship(value)) {
            const rel = value;
            recordObj[key] = {
              type: rel.type,
              properties: this.formatNeo4jValue(rel.properties),
              start: rel.start.toNumber(),
              end: rel.end.toNumber(),
              identity: rel.identity.toNumber()
            };
          } else {
            recordObj[key] = this.formatNeo4jValue(value);
          }
        }
        return recordObj;
      });
      // Limit the number of records to 20
      const limitedRecords = records.slice(0, 20);
      return JSON.stringify(limitedRecords, null, 2);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to execute query: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Search for nodes similar to a text query using vector similarity
   * @param {string} nodeType - The type of node to search for
   * @param {string} text - The text to search for
   * @param {number} limit - Maximum number of results to return
   * @param {number} minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  async vectorSearch(nodeType, text, limit = 10, minSimilarity = 0.7) {
    try {
      // Generate embedding for the search text
      const embedding = await this.generateEmbedding(text);
      
      // Convert nodeType to Neo4j label format
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Get the vector index name
      const indexName = `${label.toLowerCase()}_embedding_idx`;
      
      // First try using the vector index directly with db.index.vector.queryNodes
      try {
        console.log(`Attempting vector search using index: ${indexName}`);
        const vectorIndexQuery = `
          CALL db.index.vector.queryNodes('${indexName}', $limit, $embedding)
          YIELD node, score
          WHERE score >= $minSimilarity
          RETURN node.name AS name, node.description AS description, id(node) AS id, score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(vectorIndexQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.int(limit)
        });
        
        // Check if we got results
        if (result.records.length > 0) {
          console.log(`Vector index search successful using db.index.vector.queryNodes, found ${result.records.length} results`);
          
          const records = result.records.map(record => ({
            id: record.get('id').toNumber(),
            name: record.get('name'),
            description: record.get('description'),
            score: record.get('score')
          }));
          
          return JSON.stringify(records, null, 2);
        } else {
          console.log('No results from vector index search, trying with vector.similarity.cosine');
        }
      } catch (vectorIndexError) {
        console.error('Failed to use db.index.vector.queryNodes, falling back to vector.similarity.cosine:', vectorIndexError);
      }
      
      // If vector index search fails or returns no results, try with vector.similarity.cosine
      try {
        console.log('Attempting vector search using vector.similarity.cosine');
        const similarityQuery = `
          MATCH (n:${label})
          WHERE n.embedding IS NOT NULL
          WITH n, vector.similarity.cosine(n.embedding, $embedding) AS score
          WHERE score >= $minSimilarity
          RETURN n.name AS name, n.description AS description, id(n) AS id, score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(similarityQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.int(limit)
        });
        
        console.log(`Vector similarity search successful using vector.similarity.cosine, found ${result.records.length} results`);
        
        const records = result.records.map(record => ({
          id: record.get('id').toNumber(),
          name: record.get('name'),
          description: record.get('description'),
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      } catch (error) {
        console.error('Failed to use vector.similarity.cosine, falling back to basic search:', error);
        
        // If all vector similarity methods fail, fall back to a basic search
        console.log('Falling back to basic search without vector similarity');
        const query = `
          MATCH (n:${label})
          WHERE n.embedding IS NOT NULL
          RETURN n.name AS name, n.description AS description, id(n) AS id, 1.0 AS score
          LIMIT $limit
        `;
        
        const result = await this.session.run(query, {
          limit: neo4j.int(limit)
        });
        
        const records = result.records.map(record => ({
          id: record.get('id').toNumber(),
          name: record.get('name'),
          description: record.get('description'),
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      }
    } catch (error) {
      console.error('Failed to perform vector search:', error);
      throw error;
    }
  }

  /**
   * Perform a hybrid search combining vector similarity with graph structure
   * @param {string} nodeType - The type of node to search for
   * @param {string} text - The text to search for
   * @param {string} relationshipType - The type of relationship to traverse
   * @param {string} targetType - The type of target node
   * @param {number} limit - Maximum number of results to return
   * @param {number} minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  async hybridSearch(
    nodeType,
    text,
    relationshipType,
    targetType,
    limit = 10,
    minSimilarity = 0.0
  ) {
    try {
      // Generate embedding for the search text
      const embedding = await this.generateEmbedding(text);
      
      // Convert types to Neo4j label format
      const sourceLabel = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      const targetLabel = targetType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Get the vector index name
      const indexName = `${sourceLabel.toLowerCase()}_embedding_idx`;
      
      // First try using the vector index directly with db.index.vector.queryNodes
      try {
        console.log(`Attempting hybrid search using index: ${indexName}`);
        const vectorIndexQuery = `
          // First find similar nodes using the vector index
          CALL db.index.vector.queryNodes('${indexName}', $limit * 2, $embedding)
          YIELD node as source, score
          WHERE score >= $minSimilarity
          
          // Then match the related nodes through the specified relationship
          // For BELONGS_TO relationships, the direction is from knowledge to topic
          MATCH (source)<-[r:${relationshipType}]-(target:${targetLabel})
          
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(vectorIndexQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.int(limit)
        });
        
        // Check if we got results
        if (result.records.length > 0) {
          console.log(`Hybrid vector index search successful using db.index.vector.queryNodes, found ${result.records.length} results`);
          
          const records = result.records.map(record => ({
            source: {
              id: record.get('sourceId').toNumber(),
              name: record.get('sourceName'),
              description: record.get('sourceDescription')
            },
            relationship: {
              type: record.get('relationshipType')
            },
            target: {
              id: record.get('targetId').toNumber(),
              name: record.get('targetName'),
              description: record.get('targetDescription')
            },
            score: record.get('score')
          }));
          
          return JSON.stringify(records, null, 2);
        } else {
          console.log('No results from hybrid vector index search, trying with vector.similarity.cosine');
        }
      } catch (vectorIndexError) {
        console.error('Failed to use db.index.vector.queryNodes for hybrid search, falling back to vector.similarity.cosine:', vectorIndexError);
      }
      
      // If vector index search fails or returns no results, try with vector.similarity.cosine
      try {
        console.log('Attempting hybrid search using vector.similarity.cosine');
        const similarityQuery = `
          MATCH (source:${sourceLabel})<-[r:${relationshipType}]-(target:${targetLabel})
          WHERE source.embedding IS NOT NULL
          WITH source, r, target, vector.similarity.cosine(source.embedding, $embedding) AS score
          WHERE score >= $minSimilarity
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(similarityQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.int(limit)
        });
        
        console.log(`Hybrid similarity search successful using vector.similarity.cosine, found ${result.records.length} results`);
        
        const records = result.records.map(record => ({
          source: {
            id: record.get('sourceId').toNumber(),
            name: record.get('sourceName'),
            description: record.get('sourceDescription')
          },
          relationship: {
            type: record.get('relationshipType')
          },
          target: {
            id: record.get('targetId').toNumber(),
            name: record.get('targetName'),
            description: record.get('targetDescription')
          },
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      } catch (error) {
        console.error('Failed to use vector.similarity.cosine for hybrid search, falling back to basic search:', error);
        
        // If all vector similarity methods fail, fall back to a basic search
        console.log('Falling back to basic search without vector similarity');
        const query = `
          MATCH (source:${sourceLabel})<-[r:${relationshipType}]-(target:${targetLabel})
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            1.0 AS score
          LIMIT $limit
        `;
        
        const result = await this.session.run(query, {
          limit: neo4j.int(limit)
        });
        
        const records = result.records.map(record => ({
          source: {
            id: record.get('sourceId').toNumber(),
            name: record.get('sourceName'),
            description: record.get('sourceDescription')
          },
          relationship: {
            type: record.get('relationshipType')
          },
          target: {
            id: record.get('targetId').toNumber(),
            name: record.get('targetName'),
            description: record.get('targetDescription')
          },
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      }
    } catch (error) {
      console.error('Failed to perform hybrid search:', error);
      throw error;
    }
  }

  /**
   * Format Neo4j values to JavaScript values
   * @param {any} value - The Neo4j value to format
   * @returns {any} - The formatted value
   */
  formatNeo4jValue(value) {
    if (neo4j.isInt(value)) {
      return value.toNumber();
    } else if (Array.isArray(value)) {
      return value.map(v => this.formatNeo4jValue(v));
    } else if (value && typeof value === 'object') {
      const formatted = {};
      for (const key in value) {
        formatted[key] = this.formatNeo4jValue(value[key]);
      }
      return formatted;
    }
    return value;
  }

  /**
   * Close the Neo4j connection
   * @returns {Promise<void>}
   */
  async close() {
    await this.session.close();
    await this.driver.close();
  }
}

export default Neo4jManager;