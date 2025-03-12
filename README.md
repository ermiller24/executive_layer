# Executive Layer (ExL)

The Executive Layer (ExL) is an operability layer that lives on top of an arbitrary LLM. It provides executive thinking, course correction, contextual knowledge, and advanced planning and reasoning capabilities, while acting as a drop-in replacement for any LLM model by implementing an OpenAI-compatible API.

## Architecture

ExL operates by running two LLM instances simultaneously:

1. **Speaker Layer**: The forward-facing model that the user interacts with, providing chat, tool calls, etc.
2. **Executive Layer**: Provides support for the speaker, monitoring its output and providing corrections or additional information as needed.

Additional components:
- **Knowledge Graph**: Implemented in Neo4j, stores structured knowledge that the Executive can query and update.
- **Vector Store**: Stores embeddings of previous conversations and knowledge documents for quick retrieval.

## Flow

1. User sends a prompt to the OpenAI-compatible endpoint.
2. The prompt is passed to the Vector Store to retrieve relevant context.
3. The Speaker LLM processes the prompt with the context and streams back results to the user.
4. Simultaneously, the Executive LLM searches the Knowledge Graph for relevant information.
5. The Executive evaluates the Speaker's output and decides whether to:
   - Let it continue (if correct)
   - Interrupt with insights (if slightly off track)
   - Restart with new knowledge (if substantially wrong)
6. The Executive updates the Knowledge Graph based on the conversation.
7. The knowledge document is stored in the Vector Store for future reference.

## Components

- **API Bridge**: Provides an OpenAI-compatible API for applications to interact with ExL.
- **Speaker Service**: Handles generating responses to user queries.
- **Executive Service**: Monitors the Speaker, provides corrections, and manages the Knowledge Graph.
- **Vector Store Service**: Stores and retrieves embeddings for quick context retrieval.
- **Neo4j**: Stores the Knowledge Graph.
- **Python Chatbot**: A simple command-line interface for interacting with the ExL system.

## Supported OpenAI API Features

ExL implements all critical OpenAI API features:

- **Chat Completions**: Generate responses to conversations.
- **Embeddings**: Generate vector embeddings for text.
- **Streaming**: Stream responses token by token in real-time.
- **Tool Calling**: Allow the model to call external tools/functions.
- **JSON Mode**: Generate structured JSON responses.
- **Extended Response Mode**: Handle long-running conversations with automatic context management (see [EXTENDED_MODE.md](EXTENDED_MODE.md)).

## Setup

### Prerequisites

- Docker and Docker Compose
- Node.js (for local development)
- Make (for using the Makefile commands)
- Python 3.8+ (for the chatbot)

### Environment Variables

Create a `.env` file with the following variables:

```
# API Configuration
API_PORT=3000

# Speaker LLM Configuration
SPEAKER_PORT=8000
SPEAKER_MODEL=gpt-4o
SPEAKER_API_KEY=your_openai_api_key_here

# Executive LLM Configuration
EXECUTIVE_PORT=8001
EXECUTIVE_MODEL=gpt-4o
EXECUTIVE_API_KEY=your_openai_api_key_here

# Vector Store Configuration
VECTOR_STORE_PORT=8002
VECTOR_STORE_DIMENSION=1536
VECTOR_STORE_PATH=/data/vector_store

# Neo4j Configuration
NEO4J_URL=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Python Chatbot Configuration
ExL_API_URL=http://localhost:3000
ExL_API_KEY=dummy-api-key

# Extended Mode Configuration (optional)
DATA_DIR=/data/extended
EXTENDED_MAX_CONTEXT_SIZE=16000
EXTENDED_SUMMARIZATION_THRESHOLD=0.7
EXTENDED_PRESERVE_MESSAGE_COUNT=4
EXTENDED_EXPIRATION_TIME=86400000
EXTENDED_CLEANUP_INTERVAL=3600000
EXTENDED_SUMMARY_MODEL=openai:gpt-3.5-turbo
```

### Quick Start with Make

The project includes a Makefile with common commands to make it easier to deploy and manage the system:

```bash
# Build and start all services
make deploy

# Run tests
make test

# Run the Python chatbot
make chatbot

# View logs
make logs

# Stop all services
make stop

# Clean up (remove containers and volumes)
make clean
```

For a full list of available commands:

```bash
make help
```

### Running with Docker Compose Directly

If you prefer not to use Make, you can use Docker Compose directly:

```bash
# Build and start the services
docker-compose up --build

# Run in background
docker-compose up -d --build
```

The API will be available at `http://localhost:3000`

### Python Chatbot

The project includes a Python chatbot that provides a simple command-line interface for interacting with the ExL system. The chatbot uses Langchain to connect to the ExL system via its OpenAI-compatible API.

To run the chatbot:

```bash
# Using Make (automatically sets up Python virtual environment)
make chatbot

# Or manually
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python chatbot.py
```

The chatbot supports the following commands:
- Type your query to get a response from the ExL system
- Type 'exit' or 'quit' to exit the chatbot
- Type 'clear' to start a new conversation

### Testing

Run the test script to verify the API is working correctly:

```bash
# Using Make
make test

# Or directly
node test_api.js
```

The main test script verifies all critical OpenAI API features:
- Basic chat completions
- Embeddings
- Streaming
- Tool calling
- Streaming tool calling
- JSON mode

Additional test scripts are available for specific components:
```bash
# Test vector store integration
make test-vector

# Test knowledge graph integration
make test-exec

# Test speaker-executive interaction
make test-interaction

# Test extended response mode
make test-extended
```

## API Usage

ExL implements the OpenAI API, so you can use it as a drop-in replacement for OpenAI's API:

### Basic Chat Completion

```javascript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about quantum computing.' }
    ],
    temperature: 0.7
  })
});

const result = await response.json();
console.log(result.choices[0].message.content);
```

### Streaming

```javascript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about quantum computing.' }
    ],
    temperature: 0.7,
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const data = JSON.parse(line.substring(6));
      if (data.choices[0].delta.content) {
        process.stdout.write(data.choices[0].delta.content);
      }
    }
  }
}
```

### Tool Calling

```javascript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'system', content: 'You are a helpful assistant with access to tools.' },
      { role: 'user', content: 'What\'s the weather like in San Francisco?' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather in a given location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The city and state, e.g. San Francisco, CA'
              },
              unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'The temperature unit to use'
              }
            },
            required: ['location']
          }
        }
      }
    ],
    temperature: 0.7
  })
});

const result = await response.json();
console.log(result.choices[0].message.tool_calls);
```

### JSON Mode

```javascript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that outputs JSON.' },
      { role: 'user', content: 'Generate a JSON object with information about 3 planets in our solar system.' }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  })
});

const result = await response.json();
const jsonData = JSON.parse(result.choices[0].message.content);
console.log(jsonData);
```

### Extended Response Mode

```javascript
// Initial request with extended_thread_id
const initialResponse = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about quantum computing.' }
    ],
    temperature: 0.7,
    extended_thread_id: 'conversation-123' // Enable extended mode with a thread ID
  })
});

const initialResult = await initialResponse.json();
console.log(initialResult.choices[0].message.content);

// Follow-up request with the same thread ID (only need to send new messages)
const followUpResponse = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'eir-default',
    messages: [
      { role: 'user', content: 'How does quantum entanglement work?' }
    ],
    temperature: 0.7,
    extended_thread_id: 'conversation-123' // Same thread ID as before
  })
});

const followUpResult = await followUpResponse.json();
console.log(followUpResult.choices[0].message.content);

// Get the progress document for the thread
const progressResponse = await fetch('http://localhost:3000/v1/extended/progress/conversation-123', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
});

const progressResult = await progressResponse.json();
console.log(progressResult.progress_document);
```

## Development

### Project Structure

```
executive_layer/
├── docker-compose.yml      # Docker Compose configuration
├── Dockerfile.speaker      # Dockerfile for Speaker service
├── Dockerfile.executive    # Dockerfile for Executive service
├── Makefile                # Make commands for common operations
├── package.json            # Node.js dependencies
├── requirements.txt        # Python dependencies for the chatbot
├── .env                    # Environment variables
├── chatbot.py              # Python chatbot for interacting with ExL
├── EXTENDED_MODE.md        # Documentation for Extended Response Mode
├── src/
│   ├── speaker/            # Speaker LLM service (front-facing API)
│   │   └── server.js       # Speaker server
│   ├── executive/          # Executive LLM service
│   │   └── server.js       # Executive server
│   ├── extended/           # Extended Response Mode implementation
│   │   ├── thread-manager.js    # Thread storage and management
│   │   ├── progress-tracker.js  # Progress document management
│   │   ├── context-manager.js   # Context window management
│   │   ├── extended-mode.js     # Main extended mode implementation
│   │   └── index.js             # Module exports
│   └── knowledge/          # Knowledge graph implementation
│       ├── knowledge-tools.js   # Knowledge graph tools
│       └── neo4j-manager.js     # Neo4j database manager
├── test_api.js             # API test script
├── test_vector_store.js    # Vector store integration test
├── test_knowledge_graph.js # Knowledge graph integration test
├── test_executive_interaction.js # Executive interaction test
└── test_extended_mode.js   # Extended mode test
```

### Local Development

1. Install dependencies:
   ```
   make install
   # or
   npm install
   ```

2. Start the services in development mode:
   ```
   make dev
   ```

   Or start the services individually:
   ```
   node src/executive/server.js
   node src/speaker/server.js
   ```

3. Set up the Python environment for the chatbot:
   ```
   make setup-python
   # or
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. Run the chatbot:
   ```
   make chatbot
   # or
   python chatbot.py
   ```

## Makefile Commands

The project includes a Makefile with the following commands:

- `make deploy` - Build and start all services
- `make stop` - Stop all services
- `make restart` - Restart all services
- `make logs` - View logs from all services
- `make test` - Run the test script
- `make test-vector` - Run vector store integration test
- `make test-exec` - Run knowledge graph integration test
- `make test-interaction` - Run speaker-executive interaction test
- `make test-extended` - Run extended mode test
- `make clean` - Remove containers and volumes
- `make build` - Build all Docker images
- `make status` - Check the status of all services
- `make install` - Install Node.js dependencies
- `make dev` - Start services in development mode
- `make setup-python` - Set up Python virtual environment
- `make chatbot` - Run the Python chatbot
- `make logs-speaker` - View logs from the Speaker service
- `make logs-executive` - View logs from the Executive service
- `make logs-vector-store` - View logs from the Vector Store service
- `make logs-neo4j` - View logs from the Neo4j service

## Future Extensions

Potential extensions (not yet implemented):
- Managed Docker instance for sandboxed computations
- Different models for Speaker and Executive
- Multiple Executive models running simultaneously
- File processing and vision capabilities