#!/usr/bin/env python3
"""
EIR Chatbot - A simple command-line interface for interacting with the Executive Interrupting Rectifier.
Uses Langchain to connect to the EIR system via its OpenAI-compatible API.
"""

import os
import sys
import time
import argparse
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv

# Try to import langchain-openai, fall back to openllm if it fails
try:
    from langchain_openai import ChatOpenAI
    USING_OPENAI = True
    print("Using langchain-openai integration")
except ImportError:
    try:
        from openllm import OpenLLM
        USING_OPENAI = False
        print("Falling back to OpenLLM integration")
    except ImportError:
        print("Error: Neither langchain-openai nor openllm could be imported.")
        print("Please install the required packages:")
        print("pip install langchain langchain-openai python-dotenv")
        print("or")
        print("pip install langchain openllm python-dotenv")
        sys.exit(1)

from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain.schema import HumanMessage, SystemMessage, AIMessage

# Load environment variables
load_dotenv()

# Default configuration from environment variables
EIR_API_URL = os.getenv("EIR_API_URL", "http://localhost:3000")
EIR_API_KEY = os.getenv("EIR_API_KEY", "dummy-api-key")  # EIR doesn't require a real API key
SPEAKER_MODEL = os.getenv("SPEAKER_MODEL", "gpt-4o")
SPEAKER_MODEL_PROVIDER = os.getenv("SPEAKER_MODEL_PROVIDER", "openai")
SPEAKER_API_KEY = os.getenv("SPEAKER_API_KEY", "")
SPEAKER_API_BASE = os.getenv("SPEAKER_API_BASE", "")
EXECUTIVE_MODEL = os.getenv("EXECUTIVE_MODEL", "gpt-4o")
EXECUTIVE_MODEL_PROVIDER = os.getenv("EXECUTIVE_MODEL_PROVIDER", "openai")
EXECUTIVE_API_KEY = os.getenv("EXECUTIVE_API_KEY", "")
EXECUTIVE_API_BASE = os.getenv("EXECUTIVE_API_BASE", "")

# ANSI color codes for terminal output
COLORS = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "blue": "\033[34m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "red": "\033[31m",
    "cyan": "\033[36m",
    "magenta": "\033[35m",
}

def print_colored(text: str, color: str = "reset", end: str = "\n") -> None:
    """Print text with the specified color."""
    print(f"{COLORS.get(color, COLORS['reset'])}{text}{COLORS['reset']}", end=end)

def create_chat_model(
    api_url: str = None,
    api_key: str = None,
    speaker_model: str = None,
    speaker_model_provider: str = None,
    speaker_api_key: str = None,
    speaker_api_base: str = None,
    executive_model: str = None,
    executive_model_provider: str = None,
    executive_api_key: str = None,
    executive_api_base: str = None,
    temperature: float = 0.7
) -> Any:
    """Create and configure the chat model based on available integrations."""
    
    # Use provided values or fall back to defaults
    api_url = api_url or EIR_API_URL
    api_key = api_key or EIR_API_KEY
    speaker_model = speaker_model or SPEAKER_MODEL
    speaker_model_provider = speaker_model_provider or SPEAKER_MODEL_PROVIDER
    speaker_api_key = speaker_api_key or SPEAKER_API_KEY
    speaker_api_base = speaker_api_base or SPEAKER_API_BASE
    executive_model = executive_model or EXECUTIVE_MODEL
    executive_model_provider = executive_model_provider or EXECUTIVE_MODEL_PROVIDER
    executive_api_key = executive_api_key or EXECUTIVE_API_KEY
    executive_api_base = executive_api_base or EXECUTIVE_API_BASE
    
    # Prepare headers for custom configuration
    headers = {}
    if speaker_model:
        headers["x-speaker-model"] = speaker_model
    if speaker_model_provider:
        headers["x-speaker-model-provider"] = speaker_model_provider
    if speaker_api_key:
        headers["x-speaker-api-key"] = speaker_api_key
    if speaker_api_base:
        headers["x-speaker-api-base"] = speaker_api_base
    if executive_model:
        headers["x-executive-model"] = executive_model
    if executive_model_provider:
        headers["x-executive-model-provider"] = executive_model_provider
    if executive_api_key:
        headers["x-executive-api-key"] = executive_api_key
    if executive_api_base:
        headers["x-executive-api-base"] = executive_api_base
    
    if USING_OPENAI:
        # Use langchain-openai integration
        return ChatOpenAI(
            model="eir-default",  # This can be any string, EIR will handle it
            openai_api_key=api_key,
            openai_api_base=f"{api_url}/v1",
            streaming=True,
            callbacks=[StreamingStdOutCallbackHandler()],
            temperature=temperature,
            default_headers=headers
        )
    else:
        # Fall back to OpenLLM
        return OpenLLM(  # pylint: disable=used-before-assignment
            model="eir-default",  # This can be any string, EIR will handle it
            api_key=api_key,
            base_url=f"{api_url}/v1",
            streaming=True,
            callbacks=[StreamingStdOutCallbackHandler()],
            temperature=temperature,
            default_headers=headers
        )

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="EIR Chatbot - A command-line interface for the Executive Interrupting Rectifier")
    
    parser.add_argument("--api-url", help="EIR API URL (default: from .env or http://localhost:3000)")
    parser.add_argument("--api-key", help="EIR API key (default: from .env)")
    parser.add_argument("--speaker-model", help="Speaker model name (default: from .env or gpt-4o)")
    parser.add_argument("--speaker-provider", help="Speaker model provider (default: from .env or openai)")
    parser.add_argument("--speaker-api-key", help="Speaker API key (default: from .env)")
    parser.add_argument("--speaker-api-base", help="Speaker API base URL (default: from .env)")
    parser.add_argument("--executive-model", help="Executive model name (default: from .env or gpt-4o)")
    parser.add_argument("--executive-provider", help="Executive model provider (default: from .env or openai)")
    parser.add_argument("--executive-api-key", help="Executive API key (default: from .env)")
    parser.add_argument("--executive-api-base", help="Executive API base URL (default: from .env)")
    parser.add_argument("--temperature", type=float, default=0.7, help="Temperature for response generation (default: 0.7)")
    
    return parser.parse_args()

def main() -> None:
    """Main function to run the chatbot."""
    # Parse command line arguments
    args = parse_arguments()
    
    # Print welcome message
    print_colored("\n=== Executive Interrupting Rectifier (EIR) Chatbot ===", "bold")
    print_colored("Type 'exit', 'quit', or press Ctrl+C to exit the chatbot.", "yellow")
    print_colored("Type 'clear' to start a new conversation.", "yellow")
    print()
    
    # Print configuration
    print_colored("Configuration:", "cyan")
    print_colored(f"API URL: {args.api_url or EIR_API_URL}", "cyan")
    print_colored(f"Speaker Model: {args.speaker_model or SPEAKER_MODEL} ({args.speaker_provider or SPEAKER_MODEL_PROVIDER})", "cyan")
    print_colored(f"Executive Model: {args.executive_model or EXECUTIVE_MODEL} ({args.executive_provider or EXECUTIVE_MODEL_PROVIDER})", "cyan")
    print_colored(f"Temperature: {args.temperature}", "cyan")
    print()

    # Create the chat model
    try:
        chat_model = create_chat_model(
            api_url=args.api_url,
            api_key=args.api_key,
            speaker_model=args.speaker_model,
            speaker_model_provider=args.speaker_provider,
            speaker_api_key=args.speaker_api_key,
            speaker_api_base=args.speaker_api_base,
            executive_model=args.executive_model,
            executive_model_provider=args.executive_provider,
            executive_api_key=args.executive_api_key,
            executive_api_base=args.executive_api_base,
            temperature=args.temperature
        )
    except Exception as e:
        print_colored(f"Error initializing chat model: {e}", "red")
        print_colored("Make sure the EIR system is running (use 'make deploy').", "yellow")
        sys.exit(1)

    # Initialize conversation history
    messages = [
        SystemMessage(content="You are a helpful assistant powered by the Executive Interrupting Rectifier (EIR) system.")
    ]

    # Main conversation loop
    while True:
        try:
            # Get user input
            print_colored("\nYou: ", "green", end="")
            user_input = input()

            # Check for exit commands
            if user_input.lower() in ["exit", "quit"]:
                print_colored("Goodbye!", "blue")
                break

            # Check for clear command
            if user_input.lower() == "clear":
                messages = [
                    SystemMessage(content="You are a helpful assistant powered by the Executive Interrupting Rectifier (EIR) system.")
                ]
                print_colored("Conversation history cleared.", "blue")
                continue

            # Add user message to history
            messages.append(HumanMessage(content=user_input))

            # Print assistant response
            print_colored("Assistant: ", "blue", end="")
            
            # Get response from the model
            if USING_OPENAI:
                response = chat_model.invoke(messages)
                # Response is already streamed by the callback handler
                # Add the response to the conversation history
                messages.append(AIMessage(content=response.content))
            else:
                # For OpenLLM, we need to handle streaming differently
                response = chat_model.invoke(messages)
                # Add the response to the conversation history
                messages.append(AIMessage(content=response))

            print()  # Add a newline after the response

        except KeyboardInterrupt:
            print_colored("\nGoodbye!", "blue")
            break
        except Exception as e:
            print_colored(f"\nError: {e}", "red")
            print_colored("Make sure the EIR system is running (use 'make deploy').", "yellow")

if __name__ == "__main__":
    main()