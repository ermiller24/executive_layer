# Vector Store Integration Testing Guide

This document outlines how to verify that the vector database (ChromaDB) is properly integrated with the speaker component of the Executive Interrupting Rectifier (EIR) system.

## Overview

The EIR system uses ChromaDB as its vector database to:

1. Store responses from the speaker LLM
2. Retrieve relevant context when similar queries are encountered
3. Provide this context to the speaker to enhance its responses

## Prerequisites

- The EIR system must be deployed and running
- All services (speaker, executive, chroma, neo4j) must be operational

## Testing Process

### Step 1: Deploy the System

First, ensure the system is deployed and running:

```bash
make deploy
```

Verify that all services are operational:

```bash
make status
```

### Step 2: Run the Vector Store Integration Test

We've created a specialized test script that sends a sequence of related and unrelated queries to verify that the vector store is storing and retrieving information correctly:

```bash
make test-vector
```

This test performs the following actions:

1. Sends an initial query about quantum entanglement
2. Waits for the response to be stored in the vector store
3. Sends a similar follow-up query that should trigger retrieval from the vector store
4. Sends an unrelated query about photosynthesis (for contrast)
5. Returns to the quantum physics topic to verify consistent vector store functionality
6. Tests the embeddings endpoint directly

### Step 3: Check the Logs

The most important verification step is to examine the speaker service logs to confirm the vector store operations:

```bash
make logs-speaker
```

Look for log entries prefixed with `[VECTOR_STORE]`, which indicate vector store operations:

1. **Storage operations**: When responses are stored in the vector database
   ```
   [VECTOR_STORE] Storing streaming response in ChromaDB with ID: stream-[timestamp]
   [VECTOR_STORE] Content length: [number] characters
   [VECTOR_STORE] Successfully stored streaming response in ChromaDB at [timestamp]
   ```

2. **Retrieval operations**: When the vector store is queried for context
   ```
   [VECTOR_STORE] Querying ChromaDB for context related to: "[query]"
   [VECTOR_STORE] Found [number] relevant items in vector store
   [VECTOR_STORE] Result 1: ID=[id], Score=[score], Timestamp=[timestamp]
   [VECTOR_STORE] Content snippet: "[content]..."
   ```

### Step 4: Verify Expected Behavior

In the logs, you should observe:

1. The first query about quantum entanglement should be stored in the vector store
2. The second query (similar to the first) should find the first query's response in the vector store
3. The third query about photosynthesis should NOT find relevant context from previous responses
4. The fourth query about quantum computing should find relevant context from the first two quantum-related queries

## Debug Tips

If the vector store is not being accessed properly, check:

1. The ChromaDB service is running:
   ```bash
   make logs-vector-store
   ```

2. The embeddings functionality is working:
   ```bash
   curl -X POST http://localhost:3000/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model":"eir-embedding","input":"Test embedding generation"}'
   ```

3. Ensure the ChromaDB collection was properly initialized by checking the logs at startup

## Expected Output Example

When the vector store is functioning correctly, you should see logs similar to:

```
[VECTOR_STORE] Querying ChromaDB for context related to: "What is quantum entanglement..."
[VECTOR_STORE] Found 2 relevant items in vector store
[VECTOR_STORE] Result 1: ID=stream-1725736042, Score=0.8912, Timestamp=2025-03-07T19:27:22.123Z
[VECTOR_STORE] Content snippet: "Quantum entanglement is a phenomenon in quantum physics where two or more particles become correlated..."
[VECTOR_STORE] Result 2: ID=nonstream-1725736001, Score=0.7645, Timestamp=2025-03-07T19:26:41.456Z
```

This indicates that the speaker component is successfully accessing the vector database to retrieve relevant context when processing user queries.