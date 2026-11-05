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

- Node.js v22 or higher (required by `@langchain/openai` 1.8)
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

_This script will automatically download the 1.7GB Llama-3.2-1B GGUF model if it is not cached in `C:\Hub\Models`, then expose the server at `http://localhost:8080`._

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the Gemini keys. The agent runs on Google Gemini only. The full setup is in [Gemini setup](#gemini-setup).

```ini
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your chat key>
GEMINI_MODEL_NAME=gemini-3.5-flash-lite
EMBEDDING_PROVIDER=gemini
GEMINI_EMBEDDING_API_KEY=<your embedding key>
CONGRAPH_VECTOR_DB_PATH=storage/congraph_vectors_gemini-embedding-2_768.cgraph
```

The server refuses to start when a required variable is missing. The log names the variable and never prints its value.

`LLM_API_URL` is the default endpoint loaded at startup. It can also be changed
at runtime from the admin **LLM Monitor** (Endpoint card → _Sửa_), which
repoints the live LLM adapter without a restart. Runtime changes are not
persisted. Leave `LLM_API_URL` unset to use Google's Gemini endpoint.

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

## Gemini setup

The agent (`/api/agent/*`) uses Google Gemini for chat and for embeddings. Nothing else is accepted on that path.

### 1. Keys

Create two keys in Google AI Studio. The chat key and the embedding key are separate variables, so both can be rotated on their own:

| Variable                   | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `GEMINI_API_KEY`           | Chat model (`ChatOpenAI` at Google's OpenAI-compatible endpoint) |
| `GEMINI_EMBEDDING_API_KEY` | Embeddings (`@google/genai`)                                     |

If both keys belong to the same Google Cloud project, they share one quota. Keys live only in the gitignored `.env`. Never put them in `.env.example`, a commit, or a log.

### 2. Variables

| Variable                  | Value in `.env.example`                                    | Meaning                                                |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `LLM_PROVIDER`            | `gemini`                                                   | The only value the agent accepts                       |
| `GEMINI_MODEL_NAME`       | `gemini-3.5-flash-lite`                                    | Chat model id                                          |
| `GEMINI_OPENAI_BASE_URL`  | `https://generativelanguage.googleapis.com/v1beta/openai/` | Base URL, with the trailing slash                      |
| `GEMINI_MAX_RETRIES`      | `2`                                                        | Retries for 429, 503 and network errors                |
| `GEMINI_MAX_CONCURRENCY`  | `4`                                                        | In-flight chat calls in this process                   |
| `EMBEDDING_PROVIDER`      | `gemini`                                                   | Required. `transformers` is accepted only for rollback |
| `EMBEDDING_MODEL`         | `gemini-embedding-2`                                       | Embedding model id                                     |
| `EMBEDDING_DIM`           | `768`                                                      | Output dimension, must match the index manifest        |
| `EMBED_BATCH_SIZE`        | `50`                                                       | Inputs per embedding request during the index build    |
| `EMBED_MAX_CONCURRENCY`   | `2`                                                        | Parallel embedding requests during the index build     |
| `EMBED_MAX_TOKENS_BUDGET` | `2000000`                                                  | The index build aborts above this token total          |
| `CONGRAPH_VECTOR_DB_PATH` | `storage/congraph_vectors_gemini-embedding-2_768.cgraph`   | The vector store the server opens                      |
| `DATA_SOURCE_PATH`        | `data/Docs/Vietnam Civil Law.json`                         | Corpus file (689 articles)                             |

The agent, memory and Langfuse variables are listed in `.env.example`. Their defaults are the values shown there.

### 3. Build the Gemini index

The Gemini index is a separate store at the path above. Build it once with:

```bash
pnpm run rebuild-index:gemini
```

The build writes a manifest next to the store. At startup the server compares that manifest with the configured embedder and refuses to start on any mismatch (provider, model, dimension or prefixes). The old 384-dimension store is not touched.

### 4. Observability (optional)

Langfuse is off by default (`LANGFUSE_ENABLED=false`). To enable it, set `LANGFUSE_ENABLED=true` and fill in `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Keep `LANGFUSE_CAPTURE=metadata_only` unless you have reviewed the privacy consequences of sending text. Langfuse being down does not fail an agent run. `GET /api/agent/info` reports the observability state.

---

## Data Processing Notice

Questions and retrieved legal text are sent to Google Gemini. This applies to every question, including those from the client and admin apps, and to the corpus when it is embedded. Google's terms for the API tier in use apply. This repository does not confirm which tier is in use.

When Langfuse is enabled, trace data goes to Langfuse Cloud. With `LANGFUSE_CAPTURE=metadata_only` (the default) it carries timings, token counts, model names and tool names, not question or answer text.

This notice describes where data goes. It is not a restriction on who may use the system.

---

## Rollback to the legacy index

The server can return to the 384-dimension `transformers` index with two settings in `.env`:

```ini
CONGRAPH_VECTOR_DB_PATH=storage/congraph_vectors.cgraph
EMBEDDING_PROVIDER=transformers
```

Prerequisites:

- The legacy manifest `storage/congraph_vectors.cgraph.manifest.json` must exist next to the old store. The index build writes it.
- Chat stays on Gemini. Only the embedder and the store change.

Setting only one of the two values fails at startup with a manifest mismatch. When both are set, the server starts and logs a `warn` that says it is in rollback mode. `GET /api/agent/info` then reports `embedding.provider` as `transformers`.

Rollback is an operator action. The server never switches to it by itself.

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
