/**
 * Neo4j Knowledge Graph Manager
 * Handles all interactions with the Neo4j database for the EIR system
 */

import neo4j from 'neo4j-driver';

class Neo4jManager {
  /**
   * Initialize the Neo4j manager
   * @param {string} url - Neo4j connection URL
   * @param {string} user - Neo4j username
   * @param {string} password - Neo4j password
   */
  constructor(url, user, password) {
    this.driver = neo4j.driver(
      url,
      neo4j.auth.basic(user, password)
    );
    this.session = this.driver.session();
  }

  /**
   * Initialize the Neo4j schema (constraints and indexes)
   * @returns {Promise<void>}
   */
  async initializeSchema() {
    try {
      // Create constraints
      await this.session.run('CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT knowledge_id IF NOT EXISTS FOR (k:Knowledge) REQUIRE k.id IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_category_name IF NOT EXISTS FOR (tc:TagCategory) REQUIRE tc.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE');
      
      // Create indexes
      await this.session.run('CREATE INDEX topic_name_idx IF NOT EXISTS FOR (t:Topic) ON (t.name)');
      await this.session.run('CREATE INDEX knowledge_id_idx IF NOT EXISTS FOR (k:Knowledge) ON (k.id)');
      await this.session.run('CREATE INDEX file_path_idx IF NOT EXISTS FOR (f:File) ON (f.path)');
      await this.session.run('CREATE INDEX tag_category_name_idx IF NOT EXISTS FOR (tc:TagCategory) ON (tc.name)');
      await this.session.run('CREATE INDEX tag_name_idx IF NOT EXISTS FOR (t:Tag) ON (t.name)');
      
      console.log('Neo4j schema initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Neo4j schema:', error);
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