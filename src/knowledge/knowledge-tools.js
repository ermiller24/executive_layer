/**
 * Knowledge Graph Tools
 * Exposes Neo4j functionality as tool calls that can be bound to the LLM
 */

import Neo4jManager from './neo4j-manager.js';

let neo4jManager;

/**
 * Initialize the Neo4j manager
 * @param {string} url - Neo4j connection URL
 * @param {string} user - Neo4j username
 * @param {string} password - Neo4j password
 * @param {string} embeddingModel - Hugging Face model name for embeddings
 * @param {number} embeddingDimension - Dimension of the embedding vectors
 * @returns {Promise<void>}
 */
async function initializeNeo4jManager(url, user, password, embeddingModel = 'sentence-transformers/all-MiniLM-L6-v2', embeddingDimension = 384) {
  neo4jManager = new Neo4jManager(url, user, password, embeddingModel, embeddingDimension);
  await neo4jManager.initializeSchema();
  console.log('Neo4j manager initialized successfully');
}

/**
 * Get the Neo4j manager instance
 * @returns {Neo4jManager} - The Neo4j manager instance
 * @throws {Error} - If the Neo4j manager is not initialized
 */
function getNeo4jManager() {
  if (!neo4jManager) {
    throw new Error('Neo4j manager not initialized');
  }
  return neo4jManager;
}

/**
 * Close the Neo4j connection
 * @returns {Promise<void>}
 */
async function closeNeo4jManager() {
  if (neo4jManager) {
    await neo4jManager.close();
    console.log('Neo4j manager closed successfully');
  }
}

/**
 * Knowledge graph tool definitions
 */
const knowledgeTools = {
  /**
   * Create a node in the knowledge graph
   * @param {Object} args - Tool arguments
   * @param {string} args.nodeType - The type of node to create (tag_category, tag, topic, knowledge)
   * @param {string} args.name - The name of the node (must be unique within its type)
   * @param {string} args.description - A description of the node
   * @param {Array<{type: string, name: string}>} args.belongsTo - Optional array of nodes this node belongs to
   * @param {Object} args.additionalFields - Optional additional fields for the node
   * @returns {Promise<string>} - Success message with the created node's ID
   */
  knowledge_create_node: async (args) => {
    const { nodeType, name, description, belongsTo, path, additionalFields } = args;
    
    try {
      const nodeId = await getNeo4jManager().createNode(
        nodeType,
        name,
        description,
        belongsTo,
        path,
        additionalFields
      );
      
      return `Node created successfully with ID: ${nodeId}`;
    } catch (error) {
      throw new Error(`Failed to create node: ${error.message}`);
    }
  },
  
  /**
   * Create an edge between nodes in the knowledge graph
   * @param {Object} args - Tool arguments
   * @param {string} args.sourceType - The type of the source node
   * @param {string|string[]} args.sourceName - The name of the source node (or array of names)
   * @param {string} args.targetType - The type of the target node
   * @param {string|string[]} args.targetName - The name of the target node (or array of names)
   * @param {string} args.relationship - The type of relationship
   * @param {string} args.description - A description of the relationship
   * @returns {Promise<string>} - Success message with the created edge's ID
   */
  knowledge_create_edge: async (args) => {
    const { sourceType, sourceName, targetType, targetName, relationship, description } = args;
    
    try {
      const edgeId = await getNeo4jManager().createEdge(
        sourceType,
        sourceName,
        targetType,
        targetName,
        relationship,
        description
      );
      
      return `Edge created successfully with ID: ${edgeId}`;
    } catch (error) {
      throw new Error(`Failed to create edge: ${error.message}`);
    }
  },
  
  /**
   * Alter or delete a node in the knowledge graph
   * @param {Object} args - Tool arguments
   * @param {string} args.nodeType - The type of node to alter
   * @param {number} args.nodeId - The ID of the node to alter
   * @param {boolean} args.deleteNode - Whether to delete the node
   * @param {Object} args.fields - The fields to update (required if deleteNode is false)
   * @returns {Promise<string>} - Success message
   */
  knowledge_alter: async (args) => {
    const { nodeType, nodeId, deleteNode, fields } = args;
    
    try {
      return await getNeo4jManager().alterNode(
        nodeType,
        nodeId,
        deleteNode,
        fields
      );
    } catch (error) {
      throw new Error(`Failed to alter node: ${error.message}`);
    }
  },
  
  /**
   * Search the knowledge graph using flexible Cypher query components
   * @param {Object} args - Tool arguments
   * @param {string} args.matchClause - The Cypher MATCH clause
   * @param {string} args.whereClause - Optional Cypher WHERE clause for filtering
   * @param {string} args.returnClause - The Cypher RETURN clause specifying what to return
   * @param {Object} args.params - Optional parameters for the query
   * @returns {Promise<string>} - The query results (limited to 20 records)
   */
  knowledge_search: async (args) => {
    const { matchClause, whereClause, returnClause, params } = args;
    
    try {
      return await getNeo4jManager().searchGraph(
        matchClause,
        whereClause,
        returnClause,
        params
      );
    } catch (error) {
      throw new Error(`Failed to search knowledge graph: ${error.message}`);
    }
  },
  
  /**
   * Execute an arbitrary Cypher query against the Neo4j knowledge graph
   * @param {Object} args - Tool arguments
   * @param {string} args.query - The Cypher query to execute
   * @returns {Promise<string>} - The query results (limited to 20 records)
   */
  knowledge_unsafe_query: async (args) => {
    const { query } = args;
    
    try {
      return await getNeo4jManager().executeQuery(query);
    } catch (error) {
      throw new Error(`Failed to execute query: ${error.message}`);
    }
  },

  /**
   * Search for nodes similar to a text query using vector similarity
   * @param {Object} args - Tool arguments
   * @param {string} args.nodeType - The type of node to search for
   * @param {string} args.text - The text to search for
   * @param {number} args.limit - Maximum number of results to return
   * @param {number} args.minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  knowledge_vector_search: async (args) => {
    const { nodeType, text, limit = 10, minSimilarity = 0.7 } = args;
    
    try {
      return await getNeo4jManager().vectorSearch(
        nodeType,
        text,
        limit,
        minSimilarity
      );
    } catch (error) {
      throw new Error(`Failed to perform vector search: ${error.message}`);
    }
  },

  /**
   * Perform a hybrid search combining vector similarity with graph structure
   * @param {Object} args - Tool arguments
   * @param {string} args.nodeType - The type of node to search for
   * @param {string} args.text - The text to search for
   * @param {string} args.relationshipType - The type of relationship to traverse
   * @param {string} args.targetType - The type of target node
   * @param {number} args.limit - Maximum number of results to return
   * @param {number} args.minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  knowledge_hybrid_search: async (args) => {
    const { 
      nodeType, 
      text, 
      relationshipType, 
      targetType, 
      limit = 10, 
      minSimilarity = 0.7 
    } = args;
    
    try {
      return await getNeo4jManager().hybridSearch(
        nodeType,
        text,
        relationshipType,
        targetType,
        limit,
        minSimilarity
      );
    } catch (error) {
      throw new Error(`Failed to perform hybrid search: ${error.message}`);
    }
  }
};

/**
 * Tool schemas for the knowledge graph tools
 */
const knowledgeToolSchemas = {
  knowledge_create_node: {
    name: "knowledge_create_node",
    description: "Create a node in the knowledge graph. Node types include: tag_category, tag, topic, knowledge. Each node has a name and description, and can optionally belong to other nodes. Knowledge nodes should have a summary. Vector embeddings are automatically generated for the node name.",
    parameters: {
      type: "object",
      properties: {
        nodeType: {
          type: "string",
          description: "The type of node to create (tag_category, tag, topic, knowledge)",
          enum: ["tag_category", "tag", "topic", "knowledge"]
        },
        name: {
          type: "string",
          description: "The name of the node (must be unique within its type)"
        },
        description: {
          type: "string",
          description: "A description of the node"
        },
        belongsTo: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                description: "The type of parent node"
              },
              name: {
                type: "string",
                description: "The name of parent node"
              }
            },
            required: ["type", "name"]
          },
          description: "Optional array of nodes this node belongs to"
        },
        additionalFields: {
          type: "object",
          description: "Optional additional fields for the node"
        }
      },
      required: ["nodeType", "name", "description"]
    }
  },
  
  knowledge_create_edge: {
    name: "knowledge_create_edge",
    description: "Create an edge (relationship) between nodes in the knowledge graph. The relationship can be between any node types.",
    parameters: {
      type: "object",
      properties: {
        sourceType: {
          type: "string",
          description: "The type of the source node"
        },
        sourceName: {
          type: "string",
          description: "The name of the source node (or array of names)"
        },
        targetType: {
          type: "string",
          description: "The type of the target node"
        },
        targetName: {
          type: "string",
          description: "The name of the target node (or array of names)"
        },
        relationship: {
          type: "string",
          description: "The type of relationship"
        },
        description: {
          type: "string",
          description: "A description of the relationship"
        }
      },
      required: ["sourceType", "sourceName", "targetType", "targetName", "relationship", "description"]
    }
  },
  
  knowledge_alter: {
    name: "knowledge_alter",
    description: "Alter or delete a node in the knowledge graph. Can update fields or delete the node entirely. If the name field is updated, the vector embedding will be automatically regenerated.",
    parameters: {
      type: "object",
      properties: {
        nodeType: {
          type: "string",
          description: "The type of node to alter"
        },
        nodeId: {
          type: "number",
          description: "The ID of the node to alter"
        },
        deleteNode: {
          type: "boolean",
          description: "Whether to delete the node"
        },
        fields: {
          type: "object",
          description: "The fields to update (required if deleteNode is false)"
        }
      },
      required: ["nodeType", "nodeId", "deleteNode"]
    }
  },
  
  knowledge_search: {
    name: "knowledge_search",
    description: "Search the knowledge graph using flexible Cypher query components. Results are limited to a maximum of 20 records. This tool can search for nodes, relationships, or any combination of graph patterns.",
    parameters: {
      type: "object",
      properties: {
        matchClause: {
          type: "string",
          description: "The Cypher MATCH clause specifying what to match. Examples: '(n:Topic)', '(a:Knowledge)-[r]-(b:Knowledge)', '(t:Topic)-[r:contains]->(k:Knowledge)'"
        },
        whereClause: {
          type: "string",
          description: "Optional Cypher WHERE clause for filtering. Examples: 'n.name CONTAINS \"Quantum\"', 'a.id = 7 AND b.id = 15'"
        },
        returnClause: {
          type: "string",
          description: "Optional Cypher RETURN clause specifying what to return. If omitted, returns the first variable in the match clause. Examples: 'n', 'a, type(r), b', 'a.summary AS Source, type(r) AS Relationship, b.summary AS Target'"
        },
        params: {
          type: "object",
          description: "Optional parameters for the query"
        }
      },
      required: ["matchClause"]
    }
  },
  
  knowledge_unsafe_query: {
    name: "knowledge_unsafe_query",
    description: "Execute an arbitrary Cypher query against the Neo4j knowledge graph. Results are limited to a maximum of 20 records. This tool should be used as a last resort when the other tools are insufficient. Use with caution as it can potentially damage the knowledge graph if used incorrectly.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The Cypher query to execute against the Neo4j database."
        }
      },
      required: ["query"]
    }
  },

  knowledge_vector_search: {
    name: "knowledge_vector_search",
    description: "Search for nodes similar to a text query using vector similarity. This tool uses the vector embeddings to find semantically similar nodes.",
    parameters: {
      type: "object",
      properties: {
        nodeType: {
          type: "string",
          description: "The type of node to search for (tag_category, tag, topic, knowledge)",
          enum: ["tag_category", "tag", "topic", "knowledge"]
        },
        text: {
          type: "string",
          description: "The text to search for"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
          default: 10
        },
        minSimilarity: {
          type: "number",
          description: "Minimum similarity score (0-1)",
          default: 0.7
        }
      },
      required: ["nodeType", "text"]
    }
  },

  knowledge_hybrid_search: {
    name: "knowledge_hybrid_search",
    description: "Perform a hybrid search combining vector similarity with graph structure. This tool finds nodes that are both semantically similar to the query text and connected to other nodes through specific relationships.",
    parameters: {
      type: "object",
      properties: {
        nodeType: {
          type: "string",
          description: "The type of node to search for (tag_category, tag, topic, knowledge)",
          enum: ["tag_category", "tag", "topic", "knowledge"]
        },
        text: {
          type: "string",
          description: "The text to search for"
        },
        relationshipType: {
          type: "string",
          description: "The type of relationship to traverse"
        },
        targetType: {
          type: "string",
          description: "The type of target node",
          enum: ["tag_category", "tag", "topic", "knowledge"]
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return",
          default: 10
        },
        minSimilarity: {
          type: "number",
          description: "Minimum similarity score (0-1)",
          default: 0.7
        }
      },
      required: ["nodeType", "text", "relationshipType", "targetType"]
    }
  }
};

export {
  initializeNeo4jManager,
  getNeo4jManager,
  closeNeo4jManager,
  knowledgeTools,
  knowledgeToolSchemas
};