# Speaker-Executive Interaction Guide

This document explains how the Speaker and Executive components interact in the Executive Interrupting Rectifier (EIR) system and how to test this interaction.

## Overview

The EIR system consists of two main LLM components:

1. **Speaker**: The front-facing model that directly interacts with users
2. **Executive**: The supporting model that provides knowledge and course correction

The Executive monitors the Speaker's output and can intervene in two ways:
- **Interrupt**: Add information or corrections while allowing the Speaker to continue
- **Restart**: Stop the Speaker and restart with updated information

## Interaction Flow

1. User sends a query to the Speaker
2. Speaker retrieves context from the vector store and starts generating a response
3. Speaker accumulates its output as it generates the response
4. Executive searches the knowledge graph for relevant information
5. Speaker periodically checks if the Executive has completed its evaluation
6. When the Executive completes, it evaluates if the Speaker is on the right track
7. Executive decides whether to:
   - Do nothing (if Speaker is correct)
   - Interrupt (if Speaker has minor errors)
   - Restart (if Speaker is substantially wrong)
8. Speaker continues, incorporates interruptions, or restarts as directed

## Implementation Details

### Speaker Service

The Speaker service:
- Receives user queries via an OpenAI-compatible API
- Retrieves relevant context from ChromaDB
- Generates responses using the configured LLM
- Accumulates its output as it generates the response
- Periodically checks if the Executive has completed its evaluation
- Incorporates interruptions or restarts based on Executive feedback

Key components:
- `executiveRequest`: Contains the user query, conversation history, and Speaker output
- `executivePromise`: Tracks the Executive's evaluation process
- Streaming and non-streaming response handling with Executive integration

### Executive Service

The Executive service:
- Receives evaluation requests from the Speaker
- Searches the Neo4j knowledge graph for relevant information
- Evaluates if the Speaker is on the right track
- Decides whether to interrupt, restart, or do nothing
- Provides knowledge documents to correct the Speaker if needed

Key components:
- `/evaluate` endpoint: Main evaluation endpoint that receives the Speaker's accumulated output
- `/debug/query` endpoint: Direct access to the knowledge graph (when debug mode is enabled)

## Testing the Interaction

### Prerequisites

- The EIR system must be deployed and running
- Debug mode should be enabled for comprehensive testing

### Running the Tests

Use the provided test script to verify the Speaker-Executive interaction:

```bash
make test-interaction
```

This script tests five scenarios using a mock-based approach:

1. **Correct Information**: Tests the Executive with known correct information about France's capital
2. **Incorrect Information**: Tests the Executive with known incorrect information (claiming Lyon is France's capital)
3. **Progressive Incorrect Information**: Simulates streaming by sending partial outputs with increasingly incorrect information
4. **Completely Off-Topic Response**: Tests the Executive's restart functionality with a response that discusses the Eiffel Tower instead of answering the question about France's capital
5. **Integration Test**: Optional test with the actual Speaker API (informational only)

The mock-based approach is more reliable than depending on LLMs to generate incorrect information, as modern LLMs are designed to be truthful and may resist providing incorrect information even when asked to do so.

### Manual Testing

You can also test the interaction manually:

1. Enable debug mode in `.env`:
   ```
   DEBUG=true
   ```

2. Deploy the system:
   ```bash
   make deploy
   ```

3. Add knowledge to the graph using the debug endpoint:
   ```bash
   curl -X POST http://localhost:8001/debug/query \
     -H "Content-Type: application/json" \
     -d '{"query": "Create a topic node about Paris, the capital of France"}'
   ```

4. Test with a query that might trigger an interruption:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "eir-default",
       "messages": [
         {"role": "system", "content": "You are a helpful assistant."},
         {"role": "user", "content": "What is the capital of France? Is it Lyon?"}
       ]
     }'
   ```

5. Check the logs for details:
   ```bash
   make logs-speaker
   make logs-executive
   ```

## Troubleshooting

If the Executive is not interrupting when expected:

1. Check that the knowledge graph contains relevant information
2. Verify that the Executive service is running and accessible
3. Ensure debug mode is enabled for detailed logging
4. Check the logs for any errors in the evaluation process

If the Speaker is not receiving Executive feedback:

1. Verify the EXECUTIVE_URL environment variable is correct
2. Check for network connectivity between the services
3. Ensure the Executive service is responding to evaluation requests