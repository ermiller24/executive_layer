# Makefile for Executive Layer (ExL)

# Default shell
SHELL := /bin/bash

# Docker Compose command
DOCKER_COMPOSE := docker compose

# Python virtual environment
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

# Default target
.PHONY: help
help:
	@echo "Executive Layer (ExL) Makefile"
	@echo ""
	@echo "Usage:"
	@echo "  make deploy        - Build and start all services"
	@echo "  make stop          - Stop all services"
	@echo "  make restart       - Restart all services"
	@echo "  make logs          - View logs from all services"
	@echo "  make test          - Run the test script"
	@echo "  make test-vector   - Run vector store integration test"
	@echo "  make test-exec     - Run knowledge graph integration test"
	@echo "  make test-interaction - Run speaker-executive interaction test"
	@echo "  make clean         - Remove containers and volumes"
	@echo "  make build         - Build all Docker images"
	@echo "  make status        - Check the status of all services"
	@echo "  make install       - Install Node.js dependencies"
	@echo "  make dev           - Start services in development mode"
	@echo "  make chatbot       - Run the Python chatbot"
	@echo "  make setup-python  - Set up Python virtual environment"
	@echo ""

# Build and start all services
.PHONY: deploy
deploy:
	@echo "Building and starting all services..."
	$(DOCKER_COMPOSE) up -d --build
	@echo "Services are running. API available at http://localhost:3000"
	@echo "Run 'make logs' to view logs"

# Stop all services
.PHONY: stop
stop:
	@echo "Stopping all services..."
	$(DOCKER_COMPOSE) stop

# Restart all services
.PHONY: restart
restart:
	@echo "Restarting all services..."
	$(DOCKER_COMPOSE) restart

# Redeploy all services (tear down, rebuild, and start)
.PHONY: redeploy
redeploy:
	@echo "Redeploying all services..."
	$(DOCKER_COMPOSE) down
	$(DOCKER_COMPOSE) up -d --build
	@echo "Services are running. API available at http://localhost:3000"
	@echo "Run 'make logs' to view logs"

# View logs from all services
.PHONY: logs
logs:
	@echo "Viewing logs from all services..."
	$(DOCKER_COMPOSE) logs -f
# Run the test script
.PHONY: test
test:
	@echo "Running tests..."
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	node test_api.js

# Run the vector store integration test
.PHONY: test-vector
test-vector:
	@echo "Running vector store integration test..."
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	node test_vector_store.js

# Run the vector store integration test
.PHONY: test-exec
test-exec:
	@echo "Running knowledge graph integration test..."
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	node test_knowledge_graph.js

# Run the executive interaction test
.PHONY: test-interaction
test-interaction:
	@echo "Running speaker-executive interaction test..."
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	node test_executive_interaction.js

# Remove containers and volumes
.PHONY: clean
clean:
	@echo "Removing containers and volumes..."
	$(DOCKER_COMPOSE) down -v
	@echo "Cleaned up containers and volumes"

# Build all Docker images
.PHONY: build
build:
	@echo "Building all Docker images..."
	$(DOCKER_COMPOSE) build

# Check the status of all services
.PHONY: status
status:
	@echo "Checking status of all services..."
	$(DOCKER_COMPOSE) ps

# Install Node.js dependencies
.PHONY: install
install:
	@echo "Installing Node.js dependencies..."
	npm install

# Start services in development mode
.PHONY: dev
dev:
	@echo "Starting services in development mode..."
	@if [ ! -d "node_modules" ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	fi
	@echo "Starting Vector Store service..."
	node src/vector_store/server.js &
	@echo "Starting Executive service..."
	node src/executive/server.js &
	@echo "Starting Speaker service..."
	node src/speaker/server.js &
	@echo "Starting API service..."
	node src/api/server.js &
	@echo "All services started. API available at http://localhost:3000"
	@echo "Press Ctrl+C to stop all services"
	@wait

# Set up Python virtual environment
.PHONY: setup-python
setup-python:
	@echo "Setting up Python virtual environment..."
	python -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@echo "Python virtual environment set up successfully"
	@echo "Run 'make chatbot' to start the chatbot"

# Run the Python chatbot
.PHONY: chatbot
chatbot:
	@echo "Running the Python chatbot..."
	@if [ ! -d "$(VENV)" ]; then \
		echo "Python virtual environment not found. Setting up..."; \
		make setup-python; \
	fi
	$(PYTHON) chatbot.py

# Individual service logs
.PHONY: logs-speaker logs-executive logs-vector-store logs-neo4j

logs-speaker:
	$(DOCKER_COMPOSE) logs -f speaker

logs-executive:
	$(DOCKER_COMPOSE) logs -f executive

logs-vector-store:
	$(DOCKER_COMPOSE) logs -f chroma

logs-neo4j:
	$(DOCKER_COMPOSE) logs -f neo4j