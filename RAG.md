# RAG Implementation — Intelligent Resume Assistant

This document explains how Retrieval-Augmented Generation (RAG) is implemented
in this project: what each piece does, why it was built that way, and the
tradeoffs involved.

## TL;DR

The agent can now answer open-ended questions by **retrieving** the most
relevant passages from a resume instead of relying only on the structured
fields or stuffing the whole document into the prompt. The pipeline is:

```
resume text
   │  chunk (overlapping word windows)
   ▼
chunks ──► embed (all-MiniLM-L6-v2, local, 384-dim, normalized)
   │
   ▼
Chroma Cloud collection (cosine space, `sessionId`-scoped)
   │
   ▼  query embedded the same way, top-k nearest
retrieved passages ──► given to the LLM as a `semantic_search` tool result
```

Embeddings are computed **locally** (no embedding API key — via
`@xenova/transformers`) and the vectors are stored/searched in **Chroma Cloud**,
a managed vector database. This keeps the index durable across serverless cold
starts (the app runs on Vercel), which an in-process index cannot.

## Architecture

### Components added

| File | Responsibility |
|------|----------------|
| `src/lib/rag/embeddings.ts` | Loads `all-MiniLM-L6-v2` once (singleton) and turns text into 384-dim normalized vectors. |
| `src/lib/rag/chunker.ts` | Splits text into overlapping chunks; also flattens a structured resume to text for the restore path. |
| `src/lib/rag/vector-store.ts` | Chroma Cloud client + a single `sessionId`-scoped collection; `buildIndex` and `semanticSearch`. |
| `src/lib/rag/ingest.ts` | Orchestrates resume text → chunks → embeddings → Chroma index. |
| `src/lib/tools.ts` | Adds the `semantic_search` tool the agent can call; `executeTool` is now async. |
| `src/lib/agent.ts` | Awaits async tools; system prompt teaches when to use RAG and grounds the guardrail in retrieval. |

### Where it plugs into the existing app

- **Upload** (`/api/upload`): after the resume is parsed and a session is
  created, `ingestResume(sessionId, resume)` builds the index.
- **Restore** (`/api/restore`): rebuilds the index when a session is restored
  from the client. The client does **not** persist `raw_text`, so ingestion
  falls back to a flattened view of the structured fields.
- **Chat** (`/api/chat` → `agent.ts`): the LLM decides, per question, whether
  to call `semantic_search` or one of the existing exact-lookup tools.

## How each step works (and why)

### 1. Chunking — `chunker.ts`

Text is split into **fixed-size word windows with overlap** (default 120 words,
20-word overlap).

- **Why chunk at all?** Embedding one giant resume into a single vector blurs
  everything together; you can't retrieve "the leadership bit" specifically.
  Smaller chunks give sharper, more targeted retrieval.
- **Why overlap?** A skill or sentence that lands exactly on a chunk boundary
  would otherwise be split across two chunks and matched poorly by either.
  Overlap keeps boundary context intact in at least one chunk.
- **Tradeoff:** bigger chunks = more context but noisier/diluted matches;
  smaller chunks = sharper matches but more chunks and risk of losing
  surrounding context.

`resumeToText()` rebuilds searchable text from structured fields (name,
summary, skills, experience, education) for the restore path where `raw_text`
isn't available.

### 2. Embeddings — `embeddings.ts`

Uses `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`, running locally.

- An **embedding** is a dense vector where semantic similarity ≈ geometric
  closeness. "Node.js backend" and "Express server" land near each other;
  "watercolor painting" lands far away.
- `pooling: 'mean'` collapses per-token vectors into one vector per chunk.
- `normalize: true` makes every vector unit length, so cosine similarity is a
  clean, well-scaled measure of relevance — which is what the Chroma collection
  is configured to use (cosine space).
- The model is loaded as a **singleton** (~90 MB, downloaded once then cached);
  reloading per request would be far too slow.
- **Why local instead of OpenAI embeddings?** No API key, no per-call cost, and
  the LLM provider here (Groq) doesn't serve embeddings. Tradeoff: a smaller
  384-dim model is less powerful than `text-embedding-3-small` (1536-dim), but
  it's more than enough for single-document resume retrieval.

### 3. Vector store — `vector-store.ts`

A **single Chroma Cloud collection** (`resume_chunks`, cosine space) holds every
session's chunks. Instead of one index object per session, each chunk carries a
`sessionId` in its metadata and every read/write is scoped by a
`where: { sessionId }` filter — the standard multi-tenant pattern for a hosted
vector DB.

- `buildIndex`: deletes the session's existing chunks (replace semantics, so a
  shorter new resume can't leave stale chunks behind), then embeds all chunks
  locally and `add`s them with precomputed `embeddings`, `documents`, and
  `{ sessionId }` metadata. Chunk ids are `${sessionId}#${i}` — unique across
  the shared collection.
- `semanticSearch`: embeds the query the same way and calls `collection.query`
  with `queryEmbeddings`, `nResults`, and the `sessionId` filter. Chroma returns
  cosine **distance**; we convert to similarity (`score = 1 - distance`) so the
  rest of the app keeps its "higher = more relevant" contract and the
  `RELEVANCE_THRESHOLD` logic is unchanged.
- **Bring-your-own embeddings:** the collection is created with
  `embeddingFunction: null`. We always pass our own locally-computed vectors, so
  Chroma never has to embed anything server-side — keeping the embedding model
  identical for indexing and querying.
- **Why Chroma Cloud rather than in-process FAISS?** The app is deployed on
  Vercel, where the filesystem is ephemeral and functions are short-lived — an
  in-memory index would be rebuilt on every cold start. A managed store keeps
  the index durable and multi-tenant. Chroma uses an HNSW (approximate) index
  under the hood, which scales far past a single resume.

### 4. The agent tool — `tools.ts` + `agent.ts`

`semantic_search` is registered alongside the existing tools
(`search_resume_section`, `match_skills`, `extract_keywords`). The agent loop
now **chooses** the retrieval strategy per question:

- conceptual / fuzzy question → `semantic_search` (RAG)
- specific known section → `search_resume_section`
- compare against a skill list → `match_skills`

`executeTool` became `async` because retrieval involves embedding + search;
`agent.ts` now `await`s it.

### 5. Grounding guardrail

`semantic_search` only returns chunks whose similarity clears a relevance
threshold (`RELEVANCE_THRESHOLD = 0.25`). If nothing clears it, the tool
returns an explicit "no relevant passages found" note, and the system prompt
instructs the model to answer **"Not mentioned in resume"** and populate
`missing_data` rather than guess.

This is the core anti-hallucination pattern: **answer only from retrieved
context, and refuse when there's no grounding.** It ties RAG into the app's
existing structured-output guardrails (`confidence`, `source`, `missing_data`).

## Evaluating retrieval — `eval.ts`

Retrieval quality is measured, not eyeballed. `src/lib/rag/eval.ts` is a small
harness:

- a self-contained sample resume is chunked, embedded, and indexed;
- a hand-written **golden set** maps each question to markers that must appear
  in a retrieved chunk (substring match, robust to chunk boundaries);
- one **negative case** checks the grounding guardrail — a question with no
  answer in the resume must retrieve nothing above the relevance threshold;
- output is a single **hit-rate**.

```bash
npm run eval:rag
```

**Why it earns its keep:** the first run scored **5/7 (71%)** — the short sample
resume collapsed into a single chunk (size 120), which diluted similarity so
specific queries ("which databases?") fell below the relevance threshold.
Dropping chunk size to 45 split it into 3 chunks and the score rose to
**7/7 (100%)**, with the out-of-scope question correctly returning nothing
(top score 0.082 vs the 0.25 threshold). That is the whole point of the eval:
it turns "improving RAG" into a measured decision and catches regressions when
chunk size, the embedding model, or the threshold changes.

## Running it

Native modules that must not be bundled are declared in `next.config.ts`:

```ts
serverExternalPackages: ["pdf-parse", "@xenova/transformers"]
```

Set the Chroma Cloud credentials (locally in `.env.local`, and in the Vercel
project's environment variables for deployment):

```
CHROMA_API_KEY=...
CHROMA_TENANT=...
CHROMA_DATABASE=...
```

> Requires Node.js >= 20.9 (Next.js 16). On first run, the embedding model
> (~90 MB) downloads and is cached. The eval harness (`npm run eval:rag`) talks
> to Chroma Cloud, so it needs those same credentials.

```bash
npm install
npm run dev      # upload a resume, then ask an open-ended question
npm run build    # production build (TypeScript-checked)
```

## What I'd improve next (and why)

- **Section-aware chunking** — split on resume headers (EXPERIENCE / SKILLS)
  instead of a blind word window, so chunks align with meaning.
- **Hybrid search** — combine keyword (BM25) with vector search to catch exact
  terms (e.g. a specific tool name) that embeddings can miss.
- **Re-ranking** — run a cross-encoder over the top-k to reorder by true
  relevance before handing them to the LLM.
- **Grow the eval set** — the current harness (see above) uses one sample
  resume; expand to many resumes and more questions so the hit-rate reflects
  real retrieval difficulty.
- **Skip re-embedding on restore** — now that the vector store is persistent
  (Chroma Cloud), a restored session whose chunks already exist could reuse them
  (`hasIndex`) instead of re-embedding, saving work on the restore path.

## Glossary (quick reference)

- **Embedding** — a vector capturing meaning; close vectors ≈ similar text.
- **Cosine similarity** — angle-based similarity; equals inner product for
  normalized vectors.
- **top-k** — the k nearest chunks returned for a query.
- **ANN** — approximate nearest neighbor (HNSW/IVF); trades recall for speed at
  scale. This project uses exact flat search since the corpus is tiny.
- **Grounding** — constraining the model to answer only from retrieved context.
