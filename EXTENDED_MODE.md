# Extended Response Mode

Extended Response Mode is a feature of the Executive Layer (ExL) that enables handling of long-running conversations that may exceed context window limitations. This document explains how it works and how to use it.

## Overview

Extended Response Mode allows the system to maintain conversation history across multiple requests without requiring the client to send the full history each time. It automatically manages the context window by summarizing older messages when needed, while preserving the most recent messages for conversational coherence.

## Key Features

1. **Thread Tracking**: The system tracks conversations by a user-provided `extended_thread_id`, which can be any string. This allows the system to maintain conversation state between requests.

2. **Incremental Updates**: Users only need to send new messages in each request, as the system maintains the full conversation history internally.

3. **Executive-First Flow**:
   - Unlike regular mode where the speaker starts responding immediately, in extended mode the executive creates a detailed response plan first.
   - Only after the plan is created does the speaker begin responding, following the executive's guidance.
   - This ensures coherence and structure in long, complex responses.
   - The executive can guide the speaker through each step of the plan, ensuring comprehensive coverage of the topic.

4. **Dynamic Context Management**:
   - When responses approach the context window limit, the executive layer automatically generates a summary of earlier conversation history.
   - The summary replaces older messages in the context window, while keeping the most recent messages intact to maintain conversational coherence.
   - This allows for indefinitely long conversations without context overflow.

5. **Progress Tracking**:
   - The executive layer maintains a text file documenting the response plan and tracking progress.
   - The progress document serves as both a planning tool and a reference for the executive.
   - When the executive's own responses become lengthy, it can replace portions of its message history with references to the progress document.
   - This ensures the executive layer can maintain its reasoning capabilities even in extended conversations.

6. **Vector Store Optimization**:
   - Vector store recall is disabled in extended mode.
   - This is based on the assumption that extended mode will involve many knowledge documents and interruptions with potentially long response times, making vector store recall unnecessary for performance optimization.

## How to Use

### API Usage

To use Extended Response Mode, add an `extended_thread_id` parameter to your chat completions request:

```json
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "Tell me about the solar system."
    }
  ],
  "extended_thread_id": "conversation-123"
}
```

When you make this request:
1. The executive will first create a detailed response plan
2. The speaker will then begin responding based on this plan
3. The executive will monitor and guide the speaker's response

For follow-up messages, use the same `extended_thread_id` but only include the new messages:

```json
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "What about black holes?"
    }
  ],
  "extended_thread_id": "conversation-123"
}
```

The system will:
1. Retrieve the existing conversation history
2. Update the response plan based on the new query
3. Continue the conversation with full context of previous exchanges

### Management Endpoints

The system provides several endpoints for managing extended mode threads:

1. **Get Progress Document**:
   ```
   GET /v1/extended/progress/:threadId
   ```
   Returns the progress document for the specified thread.

2. **List All Threads**:
   ```
   GET /v1/extended/threads
   ```
   Returns a list of all active threads.

3. **Delete Thread**:
   ```
   DELETE /v1/extended/threads/:threadId
   ```
   Deletes the specified thread and all associated data.

## Configuration

Extended Response Mode can be configured through environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_DIR` | Directory for storing extended mode data | `/data/extended` |
| `EXTENDED_MAX_CONTEXT_SIZE` | Maximum context window size in tokens | `16000` |
| `EXTENDED_SUMMARIZATION_THRESHOLD` | Threshold for triggering summarization (0.0-1.0) | `0.7` |
| `EXTENDED_PRESERVE_MESSAGE_COUNT` | Number of recent messages to preserve during summarization | `4` |
| `EXTENDED_EXPIRATION_TIME` | Thread expiration time in milliseconds | `86400000` (24 hours) |
| `EXTENDED_CLEANUP_INTERVAL` | Interval for cleaning up expired threads in milliseconds | `3600000` (1 hour) |
| `EXTENDED_SUMMARY_MODEL` | Model to use for generating summaries | `openai:gpt-3.5-turbo` |
| `EXTENDED_SUMMARY_MODEL_KWARGS` | Model configuration for the summary model | Same as speaker model |

## Implementation Details

### Executive-First Flow

When a request with an `extended_thread_id` is received:

1. The system creates or retrieves the thread
2. For new threads:
   - The executive creates a detailed response plan
   - The plan is stored in the progress document
   - The speaker begins responding based on the plan
3. For existing threads:
   - The system retrieves the thread history and progress document
   - The executive updates the plan if needed
   - The speaker continues responding based on the updated plan

This executive-first approach ensures that even complex, long-running tasks maintain coherence and structure throughout the conversation.

### Thread Management

Threads are stored in an SQLite database with the following schema:

- **threads**: Stores thread metadata (ID, creation time, last access time, message count)
- **messages**: Stores individual messages for each thread
- **progress_documents**: Stores progress documents for each thread

Threads are automatically cleaned up after the expiration time (default: 24 hours).

### Summarization

When the context window utilization exceeds the summarization threshold (default: 70%), the system:

1. Preserves the most recent messages (default: 4)
2. Generates a summary of the older messages
3. Replaces the older messages with the summary
4. Updates the progress document with the summary

### Progress Tracking

The progress document is a Markdown file that contains:

- The initial request
- The detailed response plan created by the executive
- Summaries of the conversation
- The executive's evaluations and guidance
- The final response

This document serves multiple purposes:
- Planning tool for the executive
- Reference for maintaining context in long conversations
- Progress tracker for complex tasks
- Documentation of the conversation history

The progress document is updated throughout the conversation and can be retrieved at any time.

## Testing

You can test Extended Response Mode using the provided test script:

```bash
make test-extended
```

This will run a series of tests that demonstrate the extended mode features, including:

- Creating a new thread
- Sending follow-up messages
- Retrieving progress documents
- Listing active threads
- Deleting threads

## Example Use Cases

### Long-Form Content Creation

Extended Response Mode is ideal for creating long-form content such as:

- **Fiction Writing**: The executive can plan out a story's plot, characters, and setting, then guide the speaker through writing each section.
- **Technical Documentation**: For complex technical topics, the executive can create a structured outline and ensure all aspects are covered thoroughly.
- **Research Papers**: The executive can plan the methodology, literature review, results, and discussion sections, ensuring a coherent academic structure.

### Complex Problem-Solving

For problems that require multiple steps or deep analysis:

- **Software Architecture Design**: The executive can break down system requirements, plan components, and guide the speaker through detailed design decisions.
- **Mathematical Proofs**: The executive can outline the proof strategy and guide the speaker through each step of the logical reasoning.
- **Business Strategy Development**: The executive can structure market analysis, competitive positioning, and implementation plans.

### Educational Content

For teaching complex subjects:

- **Course Development**: The executive can plan a curriculum with progressive learning objectives and guide the speaker through creating lessons.
- **Tutorial Series**: For technical tutorials, the executive can ensure prerequisites are covered before advanced topics.
- **Explanatory Content**: The executive can structure explanations from basic principles to complex applications.

### Research Projects

For ongoing research that evolves over time:

- **Literature Reviews**: The executive can organize findings by theme, methodology, or chronology.
- **Data Analysis**: The executive can plan exploratory analysis, statistical testing, and interpretation phases.
- **Hypothesis Development**: The executive can track the evolution of hypotheses as new information is discovered.

## Limitations

- Extended Response Mode is not part of the standard OpenAI API and is specific to the Executive Layer.
- The system does not currently support file attachments or vision capabilities in extended mode.
- Thread data is stored in memory and will be lost if the service is restarted unless persistence is configured.
- Complex tasks may require multiple back-and-forth exchanges to complete effectively.