# GraphRAG — Knowledge Graph RAG with Genkit + Neo4j

A TypeScript implementation of GraphRAG that combines **vector similarity search** with **graph traversal** over a Neo4j knowledge graph. Built on [Google Genkit](https://genkit.dev) using Gemini for embeddings, entity extraction, and answer generation.

Unlike plain vector RAG (which only matches text chunks by semantic similarity), this project extracts entities and relationships from documents and stores them as a real graph, so the LLM can reason across multi-hop connections like *"Who supervised the PhD of my wife's husband's colleague?"*.

## Architecture

```
Documents ──► Gemini embedder ──► Neo4j vector index (similarity search)
          │
          └─► Gemini extractor ──► Entity nodes + typed relationships
                                   (Person, Location, Organization...)
                                   (LIVES_IN, WORKS_AS, MARRIED_TO...)

Query ──► 1. Vector search for top-k documents
      ──► 2. Extract entity names from question + docs
      ──► 3. Traverse graph for connected entities & relationships
      ──► 4. Gemini generates answer using both contexts
```

## Tech Stack

- **Language:** TypeScript (ES2022, strict mode)
- **AI framework:** [Genkit 1.x](https://genkit.dev)
- **LLM:** Gemini 2.5 Flash
- **Embeddings:** `gemini-embedding-001` (3072 dimensions)
- **Vector store + Graph DB:** Neo4j Aura (cloud) or local Neo4j
- **Validation:** Zod schemas on every flow

## Project Structure

```
GraphRAG/
├── src/
│   ├── index.ts              # Barrel exports
│   ├── genkit.ts             # Genkit + Google AI + Neo4j plugin setup
│   ├── refs.ts               # Indexer/retriever references
│   ├── flows.ts              # Four core flows
│   ├── graph.ts              # Entity extraction + graph CRUD + traversal
│   ├── plugin.ts             # Neo4j Genkit plugin
│   ├── indexer.ts            # Vector indexer implementation
│   ├── retriever.ts          # Vector retriever implementation
│   ├── types.ts              # Shared TypeScript types
│   └── scripts/
│       ├── index-docs.ts     # CLI: seed sample documents
│       ├── query.ts          # CLI: run GraphRAG query
│       └── reset.ts          # CLI: wipe Neo4j state
├── docs/
│   ├── sample-data.json      # 20 interconnected facts for testing
│   └── test-questions.json   # 15 questions at varying difficulty
├── .env.example              # Template for environment variables
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 20+
- A [Neo4j Aura](https://console.neo4j.io) instance (free tier works), or a local Neo4j 5.x installation
- A [Google AI API key](https://aistudio.google.com/apikey) for Gemini
- Docker (for the LiteLLM observability proxy — optional, but generation will fail if you haven't started it or pointed the app elsewhere)

## Setup

1. **Clone and install:**

   ```bash
   git clone https://github.com/jayaram9196/GraphRag.git
   cd GraphRag
   npm install
   ```

2. **Configure environment:** copy `.env.example` to `.env` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   ```env
   NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=your-neo4j-password
   NEO4J_DATABASE=neo4j
   GOOGLE_API_KEY=your-google-api-key
   ```

## LiteLLM Proxy (observability)

Groq generation calls are routed through a local [LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) so that requests, tokens, cost, and latency are recorded and visible in the LiteLLM admin UI.

**Start the proxy** (requires Docker):

```bash
docker compose -f docker-compose.litellm.yml up -d
```

This starts two containers — a Postgres for spend logs and the LiteLLM proxy on port **4001** (Genkit dev UI uses 4000, hence the offset).

**Open the admin UI** at [http://localhost:4001/ui](http://localhost:4001/ui).

- Username: `admin`
- Password: the value of `LITELLM_MASTER_KEY` in your `.env`

You'll see per-request rows with model, tokens (prompt/completion/total), cost, and latency, plus dashboards for spend over time and per-key usage.

**Stop the proxy:**

```bash
docker compose -f docker-compose.litellm.yml down
```

Add `-v` to also drop the Postgres volume and wipe history.

> Embeddings still go directly to Google Gemini and won't appear in the LiteLLM UI. Only Groq generation calls (entity extraction in `buildGraph`, and the answer step in `graphRag`) flow through the proxy.

## Usage

### Option 1 — Genkit Developer UI (recommended)

Start the Genkit dev UI:

```bash
npm run genkit:dev
```

Open `http://localhost:4000` and you'll see four flows:

1. **`indexDocuments`** — accepts `string[]`, stores documents as Neo4j nodes with vector embeddings
2. **`buildGraph`** — accepts `string[]`, extracts entities + relationships and writes the knowledge graph
3. **`retrieveFacts`** — accepts `string`, returns top-5 documents by vector similarity
4. **`graphRag`** — accepts `string`, runs the full pipeline (vector search + graph traversal + LLM generation)

**Recommended test flow:**

1. Copy the array from [`docs/sample-data.json`](docs/sample-data.json)
2. Run `indexDocuments` with it → vectors stored
3. Run `buildGraph` with the same data → graph built
4. Run `graphRag` with a question from [`docs/test-questions.json`](docs/test-questions.json)

### Option 2 — CLI scripts

```bash
# Seed 5 sample Bob/Alice facts into Neo4j
npm run index

# Run a GraphRAG query
npm run query -- "What is Bob's age?"

# Wipe all data (Document nodes, Entity nodes, vector index)
npm run reset
```

## Available Scripts

| Command | What it does |
|---------|--------------|
| `npm run genkit:dev` | Start Genkit Dev UI with all flows |
| `npm run index` | Seed sample Bob/Alice facts |
| `npm run query -- "..."` | Run full GraphRAG pipeline on a question |
| `npm run reset` | Drop vector index + delete all Document and Entity nodes |
| `npm run build` | TypeScript compile to `lib/` |
| `npm run dev` | TypeScript watch mode |
| `npm run clean` | Remove `lib/` build output |

## How It Works

### 1. Vector indexing (`indexDocuments`)
Each text is embedded via `gemini-embedding-001` and stored as a `(:Document {text, metadata, embedding})` node. A vector index is auto-created on first use with the correct dimensionality (3072) and cosine similarity.

### 2. Knowledge graph construction (`buildGraph`)
For each text, Gemini returns structured JSON with extracted entities (typed `Person`, `Location`, `Organization`, `Skill`, `Concept`) and relationships (UPPER_SNAKE_CASE like `LIVES_IN`, `WORKS_AS`). These are written as:

```cypher
(:Entity:Person {name: "Bob", age: "42"})
  -[:LIVES_IN]->
(:Entity:Location {name: "New York"})

(:Document)-[:MENTIONS]->(:Entity)
```

Entities and relationships are `MERGE`-d, so the same entity across multiple documents gets unified.

### 3. Hybrid retrieval (`graphRag`)
1. Vector search returns the top-5 most similar `Document` nodes
2. Gemini extracts entity names from the question + retrieved docs
3. A Cypher query traverses outgoing/incoming relationships from those entities
4. Both the document text AND the graph triples are passed as context to Gemini for the final answer

## Example

**Query:** `"What company does Charlie's father work for?"`

- Plain vector RAG would struggle — no single document says this directly.
- GraphRAG resolves it via: `Charlie -[:PARENT_OF]- Bob -[:WORKS_AT]-> TechNova Inc`

## Troubleshooting

**`FAILED_PRECONDITION: Please pass in the API key`** — `GOOGLE_API_KEY` is missing or misnamed in `.env`. The plugin requires `GOOGLE_API_KEY` (not `GOOGLE_GENAI_API_KEY`).

**`The client is unauthorized due to authentication failure`** — Neo4j credentials are wrong, or your Aura instance is paused. Log into [console.neo4j.io](https://console.neo4j.io), resume the instance, and update `.env`.

**`Vector index has a configured dimensionality of X, but the provided vector has dimension 3072`** — A stale vector index exists with the wrong dimensionality. Run `npm run reset` to drop it.

## License

Apache-2.0
