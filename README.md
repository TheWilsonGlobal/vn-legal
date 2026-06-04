# Vietnam Legal Consultant System

An intelligent legal consultation system for Vietnam Civil Law using GraphRAG and PathRAG methodologies. The system provides contextual legal advice by understanding relationships between legal articles and applying graph-based retrieval.

Now equipped with **Local LLM integration (Llama-3.2)**, a **Real-Time Admin Prompt Monitor & Console**, and a **Snappy Dual-Phase Client Interface** with a stable Graph Visualization panel.

---

## Features

- **🔍 Intelligent Search**: Semantic search across 689 articles of the Vietnam Civil Code.
- **🔗 Reference Chain Traversal**: Automatically follows legal references between articles.
- **📊 Hierarchical Context**: Understands legal context (Part → Chapter → Section → Subsection).
- **📝 Clause-Level Granularity**: Parses legal content into clauses (_khoản_) and points (_điểm_).
- **🤖 Multi-Provider LLM Integration**: Support for Local Llama-3.2, OpenAI, and Anthropic providers.
- **📈 Real-Time LLM Prompt Monitor**: Admin tab showing real-time prompt templates, generation outputs, and connection status.
- **💻 Interactive Diagnostic Console**: Run ad-hoc tests against the active LLM directly from the admin dashboard.
- **⚡ Dual-Phase Client Search**: Split loading that returns database results & graphs instantly (~150ms) while the LLM reasoning streams in the background.
- **📌 Stable Graph Canvas**: Preserves user zoom, pan, and node layout adjustments during background LLM responses.

---

## Tech Stack

| Component             | Technology                           |
| --------------------- | ------------------------------------ |
| **Monorepo Manager**  | pnpm Workspaces                      |
| **Backend API**       | Node.js v20+, TypeScript, Fastify    |
| **Client UI**         | React, Vite, Cytoscape.js            |
| **Admin UI**          | React, Vite, Sigma.js                |
| **Graph Database**    | ConGraphDB (Embedded)                |
| **Vector Database**   | LanceDB                              |
| **Embeddings**        | @xenova/transformers (ONNX, offline) |
| **RAG Engine**        | ConGraphRAG (PathRAG + GraphRAG)     |
| **LLM Orchestration** | LangChain.js                         |

---

## Installation

### Prerequisites

- Node.js v20 or higher
- **pnpm** (preferred for workspace management)
- Windows PowerShell (for starting the local Llama server)

### Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd vina-legal

# Install dependencies via pnpm
pnpm install
```

---

## Quick Start

### 1. Start the Local LLM Server (Optional)

If using the local `llama` provider, spin up the local model runner from the root folder:

```powershell
./start-llama-server.ps1
```

_This script will automatically download the 1.7GB Llama-3.2-1B GGUF model if it is not cached in `C:\Models`, then expose the server at `http://localhost:8080`._

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and set up your active provider:

```ini
LLM_PROVIDER=llama # Options: llama, openai, anthropic
LLM_API_URL=http://localhost:8080
LLM_MODEL=llama-3.2-1b
```

### 3. Initialize Data

```bash
# Seed both the knowledge graph and LanceDB vector store
pnpm run build-graph
pnpm run build-index-by-lancedb
```

### 4. Start the Application

Run all components (Server, Client UI, and Admin UI) concurrently:

```bash
pnpm run dev
```

- **Client UI**: Available at `http://localhost:5173` (by default)
- **Admin Dashboard**: Available at `http://localhost:5174` (by default)
- **Backend Server**: Running at `http://localhost:3000`

---

## Project Structure

```
vina-legal/
├── apps/
│   ├── server/                     # Backend API & RAG logic
│   │   ├── src/
│   │   │   ├── agent/              # LangChain integration & prompts
│   │   │   ├── api/                # Fastify endpoints and routes
│   │   │   ├── embeddings/         # Vector DB & Embedders
│   │   │   ├── graph/              # ConGraphDB schema & client
│   │   │   ├── retrieval/          # PathRAG & GraphRAG engines
│   │   │   └── shared/             # LLM Prompt Tracker & Configs
│   │   └── package.json
│   ├── client/                     # Legal consultation frontend UI
│   │   ├── src/
│   │   │   ├── App.tsx             # Main client entrypoint with Cytoscape
│   │   │   └── index.css           # Client UI styling
│   │   └── package.json
│   └── admin/                      # Database & LLM status dashboard
│       ├── src/
│       │   ├── App.tsx             # LLM Monitor tab & diagnostic console
│       │   └── SigmaGraphVisualization.tsx
│       └── package.json
├── data/                           # Vietnam Civil Code raw JSON source
├── start-llama-server.ps1          # Automatic GGUF model download and server runner
├── package.json
└── pnpm-workspace.yaml
```

---

## How It Works

### 1. Graph Construction & Indexing

- Parses legal JSON into hierarchical structures (Parts → Chapters → Sections → Subsections → Articles).
- Generates vector embeddings for article/clause levels using `@xenova/transformers`.
- Builds relationships and traversal paths within **ConGraphDB**.

### 2. Dual-Phase RAG Retrieval

When a query is submitted:

1. **Immediate Context Retrieval**: Checks LanceDB and runs PathRAG traversal (depth: 2) in **< 150ms**. The client immediately updates the document list and visualizes reference connections using Cytoscape.js.
2. **Background Reasoning**: Streams the full legal query with prompts to the local LLM in the background. The client loads the advice progressively without re-rendering or layout-refreshing the graph.

---

## Known Limitations

1. Uses an in-memory graph (placeholder for ConGraphDB production).
2. Single-threaded offline embedding generation.
3. No caching layer.
4. No user authentication/authorization.

---

## Roadmap

- [ ] ConGraphDB production integration.
- [x] LLM API & local `llama-server` integration.
- [x] Dual-phase background streaming client UI.
- [x] Admin console with live LLM tracker & diagnostics.
- [ ] Response caching layer.
- [ ] Docker container support.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see LICENSE file for details.

---

**Note**: This system provides legal information for reference only and does not constitute professional legal advice. For serious legal matters, please consult a qualified lawyer.
