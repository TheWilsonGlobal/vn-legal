# Vietnam Legal Consultant System

A legal consultation system for Vietnam Civil Law (689 articles) built on GraphRAG and PathRAG. It finds the relevant articles, follows the references between them, and gives a grounded answer with citations.

Two paths are in the code today:

- **Agent workbench** (`/api/agent/*`, used by the client workbench): sessions, memory, step trace, observability. Chat and embeddings use **Google Gemini only**.
- **Legacy consultation** (`/api/consult`): one retrieval pass and one LLM call. It still accepts the older providers (Llama, OpenAI, Anthropic, template). It is kept as the baseline until the agent is verified.

> **Status (2026-11-08).** The agent's tool-calling loop (LangGraph) is **not built yet**. The current agent runner wraps the legacy pipeline. The boot-time checks described in [Gemini setup](#gemini-setup) are also **not wired yet**. See [Known limitations](#known-limitations).

---

## Features

- **Hybrid retrieval**: vector search over articles and clauses, plus reference traversal (PathRAG) across the legal graph.
- **Hierarchical context**: Part → Chapter → Section → Subsection → Article → Clause.
- **Session memory**: a per-session window of recent turns, a compressed summary of older turns, and recall of what was asked earlier.
- **Persistent sessions**: append-only JSON-lines log per session, with a SHA-256 hash chain and a verify endpoint. Soft delete.
- **Observability**: optional Langfuse Cloud traces, with metadata-only capture by default.
- **Admin dashboard**: LLM monitor, graph explorer, vector store view, activity log.

---

## Tech Stack

| Component             | Technology                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| **Monorepo Manager**  | pnpm workspaces                                                                     |
| **Backend API**       | Node.js 22+, TypeScript, Fastify                                                    |
| **Client UI**         | React 19, Vite                                                                      |
| **Admin UI**          | React 19, Vite, Sigma.js                                                            |
| **Graph store**       | ConGraphDB (embedded, `.cgraph` files)                                              |
| **Vector store**      | ConGraphDB HNSW tables (cosine)                                                     |
| **Embeddings**        | `gemini-embedding-2`, 768-d (agent path). `paraphrase-multilingual-MiniLM` 384-d (legacy rollback, `@xenova/transformers`) |
| **Chat model**        | `gemini-3.5-flash-lite` through Google's OpenAI-compatible endpoint (`@langchain/openai`) |
| **RAG engine**        | ConGraphRAG (`congraph-rag`: PathRAG + GraphRAG)                                    |
| **Agent framework**   | LangGraph.js (`@langchain/langgraph`), installed, not yet used in code              |
| **Observability**     | OpenTelemetry + Langfuse (`@langfuse/*`), optional                                  |

---

## Installation

### Prerequisites

- Node.js 22 or higher (required by `@langchain/openai` 1.8)
- **pnpm** (the lockfile is `pnpm-lock.yaml`)
- Windows PowerShell, only if you run the optional local Llama server

### Clone and Install

```bash
git clone <repository-url>
cd vina-legal
pnpm install
```

---

## Quick Start

### 1. Start the Local LLM Server (legacy, optional)

Only for the legacy `llama` provider:

```powershell
./start-llama-server.ps1
```

_The script downloads the 1.7 GB Llama-3.2-1B GGUF model if it is not cached in `C:\Hub\Models`, then serves it at `http://localhost:8080`._

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in the keys. The agent runs on Google Gemini. The full setup is in [Gemini setup](#gemini-setup).

```ini
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your chat key>
GEMINI_MODEL_NAME=gemini-3.5-flash-lite
EMBEDDING_PROVIDER=gemini
GEMINI_EMBEDDING_API_KEY=<your embedding key>
CONGRAPH_VECTOR_DB_PATH=storage/congraph_vectors_gemini-embedding-2_768.cgraph
```

`LLM_API_URL` is used only by the legacy adapters. It can be changed at runtime from the admin **LLM Monitor** (Endpoint card → _Sửa_), which repoints the legacy adapter without a restart. Runtime changes are not persisted.

Never put keys in `.env.example`, a commit or a log. Keys live only in the gitignored `.env`.

### 3. Initialize Data

```bash
# Knowledge graph (both paths)
pnpm run build-graph
```

Vector index, choose one:

```bash
# Agent path: the Gemini index (768-d). See "Build the Gemini index" below.
pnpm run rebuild-index:gemini

# Legacy path: the 384-d index. Set EMBEDDING_PROVIDER=transformers and
# CONGRAPH_VECTOR_DB_PATH=storage/congraph_vectors.cgraph first.
pnpm run build-index-by-congraphdb
```

### 4. Start the Application

```bash
pnpm run dev
```

- **Client UI**: `http://localhost:5173`
- **Admin Dashboard**: `http://localhost:5174`
- **Backend Server**: `http://localhost:3000`

---

## Gemini setup

The agent (`/api/agent/*`) uses Google Gemini for chat and for embeddings. Nothing else is accepted on that path, once the guard is wired (see the status note below).

> **Status.** The variables, the Gemini clients, the index build script and the manifest format are in place. Three things described below are **planned but not yet wired into server startup**:
>
> 1. the Gemini-only provider guard,
> 2. the boot-time manifest check that refuses to start on a mismatch,
> 3. the agent's LLM status probe (it currently always reports reachable).
>
> Until they are wired, keep `CONGRAPH_VECTOR_DB_PATH` and `EMBEDDING_PROVIDER` consistent by hand. `.env` must point at the store that matches the embedder.

### 1. Keys

Create two keys in Google AI Studio. The chat key and the embedding key are separate variables, so each can be rotated on its own:

| Variable                   | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `GEMINI_API_KEY`           | Chat model (`ChatOpenAI` at Google's OpenAI-compatible endpoint) |
| `GEMINI_EMBEDDING_API_KEY` | Embeddings (`@google/genai`)                                     |

If both keys belong to the same Google Cloud project, they share one quota.

### 2. Variables

| Variable                  | Value in `.env.example`                                    | Meaning                                                |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `LLM_PROVIDER`            | `gemini`                                                   | The only value the agent accepts (planned guard)       |
| `GEMINI_MODEL_NAME`       | `gemini-3.5-flash-lite`                                    | Chat model id                                          |
| `GEMINI_OPENAI_BASE_URL`  | `https://generativelanguage.googleapis.com/v1beta/openai/` | Base URL, with the trailing slash                      |
| `GEMINI_MAX_RETRIES`      | `2`                                                        | Retries for 429, 503 and network errors                |
| `GEMINI_MAX_CONCURRENCY`  | `4`                                                        | In-flight chat calls in this process                   |
| `EMBEDDING_PROVIDER`      | `gemini`                                                   | `gemini`, or `transformers` for rollback only          |
| `EMBEDDING_MODEL`         | `gemini-embedding-2`                                       | Embedding model id                                     |
| `EMBEDDING_DIM`           | `768`                                                      | Output dimension, must match the index manifest        |
| `EMBED_BATCH_SIZE`        | `50`                                                       | Inputs per embedding request during the index build    |
| `EMBED_MAX_CONCURRENCY`   | `2`                                                        | Parallel embedding requests during the index build     |
| `EMBED_MAX_TOKENS_BUDGET` | `2000000`                                                  | The index build aborts above this token total          |
| `CONGRAPH_VECTOR_DB_PATH` | `storage/congraph_vectors_gemini-embedding-2_768.cgraph`   | The vector store the server opens                      |
| `DATA_SOURCE_PATH`        | `data/Docs/Vietnam Civil Law.json`                         | Corpus file (689 articles)                             |

The agent, memory and Langfuse variables are listed in `.env.example`, with their defaults.

### 3. Build the Gemini index

The Gemini index is a separate store at the path above. Run the build script in its modes:

```bash
pnpm run rebuild-index:gemini -- --smoke     # one embedding call, checks length and norm
pnpm run rebuild-index:gemini -- --dry-run   # counts inputs and tokens, makes live countTokens calls
pnpm run rebuild-index:gemini -- --build     # writes the store and its manifest
pnpm run rebuild-index:gemini -- --offline   # local char/4 estimate, no network; exits 3 by design
```

`--build` refuses to write into a store that already has content but no manifest. The build writes a manifest next to the store. The old 384-dimension store is not touched.

### 4. Observability (optional)

Langfuse is off by default (`LANGFUSE_ENABLED=false`). To enable it, set `LANGFUSE_ENABLED=true` and fill in `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Keep `LANGFUSE_CAPTURE=metadata_only` unless you have reviewed the privacy consequences of sending text. Langfuse being down does not fail an agent run; the tracer logs a warning instead.

---

## Data Processing Notice

Questions and retrieved legal text are sent to Google Gemini. This applies to every question, including those from the client and admin apps, and to the corpus when it is embedded. Google's terms for the API tier in use apply. This repository does not confirm which tier is in use.

When Langfuse is enabled, trace data goes to Langfuse Cloud. With `LANGFUSE_CAPTURE=metadata_only` (the default) it carries timings, token counts, model names and tool names, not question or answer text.

This notice describes where data goes. It is not a restriction on who may use the system.

---

## Rollback to the legacy index

Rollback returns the server to the 384-dimension `transformers` index. It uses two settings in `.env`:

```ini
CONGRAPH_VECTOR_DB_PATH=storage/congraph_vectors.cgraph
EMBEDDING_PROVIDER=transformers
```

Prerequisites:

- The legacy manifest `storage/congraph_vectors.cgraph.manifest.json` must exist next to the old store.
- Chat stays on Gemini. Only the embedder and the store change.

Rollback is an operator action. The server never switches to it by itself. **Until the boot-time manifest check is wired**, a mismatch is not caught at startup. Change both settings together, then check `GET /api/agent/info`, which reports `embedding.provider`.

---

## Project Structure

```
vina-legal/
├── apps/
│   ├── server/                       # Fastify API, retrieval and agent
│   │   ├── src/
│   │   │   ├── agent/                # Legacy pipeline, contract, memory/, sessions/
│   │   │   ├── api/                  # server.ts, routes/ (agent, consult, admin/), plugins/
│   │   │   ├── embeddings/           # Gemini and legacy embedders, index manifest, vector stores
│   │   │   ├── graph/                # ConGraphDB schema and client
│   │   │   ├── observability/        # Tracer, Langfuse exporter, masking
│   │   │   ├── retrieval/            # HybridRetrieval (PathRAG + GraphRAG)
│   │   │   ├── scripts/              # build-graph, rebuild-index-gemini, legacy index builders
│   │   │   └── shared/               # config, logger, types
│   │   └── tests/                    # unit/, integration/agent/ (live, gated), eval/
│   ├── client/                       # Agent workbench UI
│   │   └── src/
│   │       ├── layout/               # Sidebar, Topbar, view registry
│   │       └── views/                # assistant, sessions, knowledge, traces, settings
│   └── admin/                        # Admin dashboard
│       └── src/views/                # Overview, LLM Monitor, Graph Explorer, Vector Store, ...
├── data/                             # Corpus JSON and community reports
├── storage/                          # Local stores, manifests, agent session logs (gitignored)
├── start-llama-server.ps1            # Legacy: GGUF model download and server runner
├── package.json
└── pnpm-workspace.yaml
```

---

## How It Works

### 1. Graph construction and indexing

- Parses the legal JSON into a hierarchy (Parts → Chapters → Sections → Subsections → Articles → Clauses).
- Builds `REFERENCES` edges between clauses, which PathRAG traverses.
- Writes article, clause and community-report vectors into ConGraphDB HNSW tables.
- The Gemini index build writes a manifest beside the store. The manifest records the provider, model, dimension and prefixes.

### 2. Retrieval

For a query, `HybridRetrieval` runs vector search for seed articles, then PathRAG traversal to pull in referenced articles. The `local` mode works on articles and clauses. The `global` mode uses community reports.

### 3. Answering

- **Legacy `/api/consult`**: one retrieval pass, then one LLM call. The client calls it twice: once with `retrievalOnly:true` for the fast graph, then again for the answer.
- **Agent `/api/agent/*`**: the step trace (`thought`, `action`, `observation`, `reflection`, `final`) is streamed to the client. In the current build the steps come from the legacy pipeline, so they show retrieval only. The tool-calling loop is planned.

---

## Known limitations

1. **The agent tool loop is not built.** The agent runner calls the legacy single-shot pipeline. The `tool_mode` field is reported as `native`, but no tool calls run. Planned: a LangGraph graph with native tool calling. It is blocked on a Gemini `thought_signature` issue: LangChain's OpenAI adapter drops the field, so the second tool turn fails with HTTP 400.
2. **The agent LLM probe always reports reachable.** `GET /api/agent/info` does not check Gemini.
3. **Boot checks are not wired.** The Gemini-only guard and the index manifest check at startup are not in `server.ts`.
4. **The Gemini index is empty.** It has not been built. Until it is, agent retrieval has nothing to return from that store.
5. **No real authentication.** Ownership uses an anonymous cookie. `REQUIRE_LOGIN=false`. IAM and Supabase settings exist, but this README does not document their wiring.
6. **Legacy paths keep their silent fallbacks.** The legacy `/api/consult` path can return a template answer when the LLM fails. The agent path does not do this by design.
7. **Community reports are embedded with the query prefix** in the admin rebuild route. The fix is planned.

---

## Roadmap

- [x] Agent workbench UI (client views and layout)
- [x] Session store with hash chain, session memory and recall-intent routing
- [x] Observability with optional Langfuse, masking and fail-open
- [x] Gemini embedder, index manifest, rebuild script
- [x] Agent eval harness (self-test passing; no live run yet)
- [ ] LangGraph agent with native tool calling
- [ ] Boot-time Gemini guard and manifest check
- [ ] Build the Gemini index and run the live agent eval
- [ ] Remove the legacy pipeline (phase 02)
- [ ] Real authentication and roles
- [ ] Response caching layer
- [ ] Docker container support

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License. See the LICENSE file for details.

---

**Note**: This system provides legal information for reference only and does not constitute professional legal advice. For serious legal matters, please consult a qualified lawyer.
