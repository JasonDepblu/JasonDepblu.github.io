# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a hybrid personal blog combining Jekyll (static site generator) and React (chat interface). The main blog is built with Jekyll and deployed to GitHub Pages or Netlify, while a React-based RAG (Retrieval-Augmented Generation) chatbot is integrated at the `/chat` path. The chatbot allows visitors to query blog content using AI-powered search via Pinecone vector database.

Working directory: `JasonDepblu.github.io/`

## Architecture

### Dual Technology Stack

1. **Jekyll Static Blog** (Primary)
   - Static site generator for blog posts and pages
   - Posts stored in `_posts/` as Markdown files with YAML front matter
   - Custom layouts in `_layouts/` (default, home, post, page, chat)
   - Configuration in `_config.yml`
   - Output directory: `_site/`

2. **React Chat Application** (Embedded)
   - Source code in `src/` directory
   - Components in `src/components/` (ChatBot, MessageList, ChatInput, etc.)
   - Custom hooks in `src/hooks/` (useChatApi, useLocalStorage)
   - Build output copied to `_site/chat/` during integrated build
   - Served at `/chat` path with homepage configured in package.json

3. **Netlify Serverless Functions**
   - Located in `netlify/functions/`
   - **rag/index.js**: Main RAG query handler using Pinecone + Silicon Flow API
   - **status/index.js**: Request status polling endpoint
   - **utils/**: Shared utilities (session-manager.js, vector-db.js)

### Integration Process

The `build-integrated.sh` script performs the following:
1. Builds Jekyll site to `_site/`
2. Builds React app to `build/` with `PUBLIC_URL=/chat`
3. Extracts Jekyll's `<header>` and `<footer>` from `_site/index.html`
4. Injects extracted header/footer into React's `build/index.html`
5. Copies integrated React build to `_site/chat/`

This ensures the React chat interface shares the same visual layout as the Jekyll blog.

## Build & Development Commands

### Jekyll Development
```bash
# Local development server (with hot reload)
bundle exec jekyll serve --watch --incremental --port 8889

# Development with specific environment
JEKYLL_ENV=development bundle exec jekyll serve --watch --incremental --port 8889

# Production build
bundle exec jekyll build

# Clean build artifacts
bundle exec jekyll clean
```

### React Development
```bash
# Start React development server
npm start

# Build React app for production
npm run build

# Build React with integrated Jekyll layout (dev mode)
npm run dev:react

# Serve Netlify functions locally
npm run dev:functions
```

### Integrated Development
```bash
# Run full integrated development environment
# Starts Jekyll, React, and Netlify functions concurrently
npm run dev
```

This command runs three processes in parallel:
- Jekyll server on port 8889
- React build with integration (after 10s delay)
- Netlify functions server (after 15s delay)

### Production Build
```bash
# Full integrated build for deployment
./build-integrated.sh

# Or via npm (if configured)
npm run build
```

### Netlify CLI
```bash
# Install Netlify CLI (if needed)
npm install -g netlify-cli

# Local development with functions
netlify dev

# Test functions locally
netlify functions:serve

# Deploy to Netlify
netlify deploy --prod
```

## Environment Variables

Required for Netlify Functions (create `.env` file in `JasonDepblu.github.io/`):

```bash
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
SILICONE_API_KEY=your_silicon_flow_api_key
```

- **PINECONE_API_KEY**: Pinecone vector database API key
- **PINECONE_INDEX_NAME**: Name of Pinecone index storing blog embeddings
- **SILICONE_API_KEY**: Silicon Flow API key for embeddings and chat models

## File Structure

```
JasonDepblu.github.io/
├── _config.yml              # Jekyll configuration
├── _posts/                  # Blog posts (Markdown)
├── _layouts/                # Jekyll layouts
├── _includes/               # Jekyll partials
├── _data/                   # YAML data files
├── _site/                   # Jekyll build output (gitignored)
│   └── chat/                # React app copied here after integration
├── src/                     # React source code
│   ├── App.jsx              # React root component
│   ├── components/          # React components
│   ├── hooks/               # Custom React hooks
│   └── utils/               # React utilities
├── netlify/
│   └── functions/           # Serverless functions
│       ├── rag/             # RAG query handler
│       ├── status/          # Status polling
│       └── utils/           # Shared function utilities
├── build/                   # React build output (temporary)
├── public/                  # React public assets
├── package.json             # Node dependencies and scripts
├── Gemfile                  # Ruby dependencies
├── netlify.toml             # Netlify configuration
├── build-integrated.sh      # Production integration script
└── dev-integrated.sh        # Development integration script
```

## Key Technical Details

### RAG Chat System

The chatbot uses a RAG (Retrieval-Augmented Generation) approach:
1. User sends query via React frontend
2. Netlify function (`rag/index.js`) receives query
3. Query is embedded using Silicon Flow embedding model (`BAAI/bge-m3`)
4. Pinecone vector search retrieves relevant blog content
5. Retrieved content + user query sent to Silicon Flow LLM (`Qwen/QwQ-32B` for reasoning)
6. Response streamed back to frontend or polled via status endpoint

### Session Management

- Sessions tracked via `sessionManager` in `utils/session-manager.js`
- Session IDs stored in localStorage on frontend
- Conversation history maintained across requests

### Streaming Responses

- Frontend supports streaming and polling modes (toggle in UI)
- `useChatApi` hook handles both modes
- Automatic fallback to polling if streaming fails 3+ times

### Jekyll-React Integration

- Jekyll header/footer extracted via `sed` commands in shell scripts
- React build modified to include Jekyll layout elements
- Ensures consistent navigation and styling across blog and chat

## Development Workflow

1. **Working on blog content**: Edit Markdown files in `_posts/`, run `bundle exec jekyll serve`
2. **Working on chat UI**: Edit files in `src/components/`, run `npm start` or `npm run dev:react`
3. **Working on serverless functions**: Edit files in `netlify/functions/`, run `npm run dev:functions`
4. **Testing full integration**: Run `npm run dev` or `./dev-integrated.sh`
5. **Deploying**: Run `./build-integrated.sh` and deploy via Netlify or commit to trigger CI/CD

## Testing

The project uses GitHub Actions for CI/CD (see `.github/workflows/`). Multiple workflow configurations exist for different branches.

## Ruby & Node Versions

- **Ruby**: ~3.3.5 (specified in Gemfile)
- **Node**: Compatible with React 19.0.0 and React Scripts 5.0.1
- **Jekyll**: ~3.9.3

## Notes

- The `bak/` directory contains backup files and experimental code
- `_site/` and `build/` directories are build artifacts (not version controlled)
- The chat route (`/chat`) is handled via Netlify redirects (see `netlify.toml`)
- Keep `.env` file out of version control (contains API keys)
