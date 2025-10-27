# Jason's Blog

A modern personal blog integrated with an AI chat assistant, combining Jekyll static site generator and React framework, providing intelligent blog content queries powered by RAG (Retrieval-Augmented Generation) technology.

## Project Overview

This is an innovative hybrid technology stack blog project:
- **Main Site**: Static blog built with Jekyll, publishing technical articles, paper notes, and personal insights
- **AI Chat Assistant**: React-based intelligent chat interface (at `/chat` path) for querying and discussing blog content
- **RAG Technology**: Semantic search and intelligent Q&A powered by Pinecone vector database and Silicon Flow API

## Key Features

- ✍️ **Markdown Writing**: Write blog posts in Markdown format with code highlighting and math formula support
- 🤖 **AI Chat Assistant**: Visitors can ask questions about blog content through the chat interface
- 🔍 **Semantic Search**: Intelligent content retrieval based on vector database, not simple keyword matching
- 💬 **Streaming Responses**: Supports both real-time streaming output and polling modes
- 📱 **Responsive Design**: Optimized for desktop and mobile devices
- 🚀 **Serverless Architecture**: Backend logic handled by Netlify Functions

## Tech Stack

### Frontend
- **Jekyll 3.9.3**: Static site generator
- **React 19.0.0**: Chat interface framework
- **Markdown/Kramdown**: Article format
- **CSS**: Styling

### Backend
- **Netlify Functions**: Serverless functions (Node.js)
- **Pinecone**: Vector database for storing article embeddings
- **Silicon Flow API**:
  - Embedding Model: `BAAI/bge-m3`
  - Reasoning Model: `Qwen/QwQ-32B`
  - Chat Model: `Qwen/Qwen2.5-14B-Instruct`

### Deployment
- **Netlify**: Primary deployment platform
- **GitHub Pages**: Alternative deployment option

## Getting Started

### Prerequisites

- **Ruby** ~3.3.5
- **Node.js** 16+
- **Bundler** (Ruby package manager)
- **npm** or **yarn**

### Installation

```bash
# Clone the repository
git clone https://github.com/JasonDepblu/JasonDepblu.github.io.git
cd JasonDepblu.github.io

# Install Ruby dependencies
bundle install

# Install Node.js dependencies
npm install
```

### Configure Environment Variables

Create a `.env` file in the project root:

```bash
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_index_name
SILICONE_API_KEY=your_silicon_flow_api_key
```

### Local Development

#### Run Jekyll Blog Only

```bash
bundle exec jekyll serve --watch --incremental --port 8889
```

Visit http://localhost:8889

#### Run Full Application (Blog + Chat)

```bash
npm run dev
```

This will start:
- Jekyll server (port 8889)
- React development build
- Netlify Functions local server

Access:
- Blog: http://localhost:8889
- Chat: http://localhost:8889/chat

#### Develop React Chat Interface Separately

```bash
npm start
```

### Production Build

```bash
# Run the integrated build script
./build-integrated.sh
```

This script will:
1. Build Jekyll site to `_site/`
2. Build React app to `build/`
3. Extract Jekyll's header and footer
4. Inject header/footer into React build
5. Copy integrated React app to `_site/chat/`

## Project Structure

```
JasonDepblu.github.io/
├── _posts/                  # Blog posts (Markdown)
├── _layouts/                # Jekyll layout templates
├── _includes/               # Jekyll reusable components
├── _data/                   # YAML data files
├── src/                     # React source code
│   ├── components/          # React components
│   │   ├── ChatBot.jsx      # Main chat component
│   │   ├── MessageList.jsx  # Message list
│   │   └── ChatInput.jsx    # Input box
│   ├── hooks/               # Custom hooks
│   │   ├── useChatApi.js    # API communication logic
│   │   └── useLocalStorage.js
│   └── utils/               # Utility functions
├── netlify/functions/       # Netlify serverless functions
│   ├── rag/                 # RAG query handler
│   ├── status/              # Status polling
│   └── utils/               # Shared utilities
├── _site/                   # Jekyll build output
├── build/                   # React build output
├── _config.yml              # Jekyll configuration
├── package.json             # Node.js configuration
├── Gemfile                  # Ruby dependencies
└── netlify.toml             # Netlify configuration
```

## How to Write Blog Posts

1. Create a new file in `_posts/` directory with the naming format: `YYYY-MM-DD-title.markdown`

2. Add YAML Front Matter:

```markdown
---
layout: post
title: "Your Article Title"
date: 2025-01-15 10:00:00 +0800
categories: [Technology, AI]
tags: [Machine Learning, NLP]
---

# Article Content

Your content...
```

3. Preview with local server:

```bash
bundle exec jekyll serve --watch
```

## How the AI Chat Assistant Works

1. **Article Indexing**: Blog posts are converted to vector embeddings and stored in Pinecone vector database
2. **User Query**: When user asks a question, it's also converted to a vector
3. **Semantic Search**: Search for the most relevant article segments in Pinecone
4. **Generate Answer**: Retrieved content and user question are sent to LLM to generate an accurate answer
5. **Streaming Output**: Answer is returned to frontend in real-time via streaming or polling mode

## Deployment

### Deploy to Netlify

1. Connect GitHub repository to Netlify
2. Set build command: `./build-integrated.sh`
3. Set publish directory: `_site`
4. Configure environment variables (in Netlify console)
5. Trigger deployment

### Deploy to GitHub Pages

1. Push code to `gh-pages` branch
2. Enable GitHub Pages in repository settings
3. Note: GitHub Pages doesn't support Netlify Functions, so chat functionality will be unavailable

## Development Notes

- **Modify blog content**: Edit Markdown files in `_posts/`
- **Modify chat interface**: Edit React components in `src/components/`
- **Modify RAG logic**: Edit `netlify/functions/rag/index.js`
- **Modify layout/styling**: Edit files in `_layouts/` and CSS files

## Contributing

Issues and Pull Requests are welcome!

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Contact

- Email: depblugz@gmail.com
- Blog: [https://jasondepblu.github.io](https://jasondepblu.github.io)

## Acknowledgments

- Jekyll Community
- React Team
- Netlify Platform
- Pinecone and Silicon Flow API
