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
FAISS IndexFlatIP (inner product = cosine similarity)
   │
   ▼  query embedded the same way, top-k nearest
retrieved passages ──► given to the LLM as a `semantic_search` tool result
```

Everything runs locally — no embedding API key required (embeddings via
`@xenova/transformers`, vector search via `faiss-node`).

## Architecture

### Components added

| File | Responsibility |
|------|----------------|
| `src/lib/rag/embeddings.ts` | Loads `all-MiniLM-L6-v2` once (singleton) and turns text into 384-dim normalized vectors. |
| `src/lib/rag/chunker.ts` | Splits text into overlapping chunks; also flattens a structured resume to text for the restore path. |
| `src/lib/rag/vector-store.ts` | Per-session FAISS index (`IndexFlatIP`); `buildIndex` and `semanticSearch`. |
| `src/lib/rag/ingest.ts` | Orchestrates resume text → chunks → embeddings → FAISS index. |
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
- `normalize: true` makes every vector unit length, so **inner product equals
  cosine similarity** — which is why the FAISS index can use plain inner
  product below.
- The model is loaded as a **singleton** (~90 MB, downloaded once then cached);
  reloading per request would be far too slow.
- **Why local instead of OpenAI embeddings?** No API key, no per-call cost, and
  the LLM provider here (Groq) doesn't serve embeddings. Tradeoff: a smaller
  384-dim model is less powerful than `text-embedding-3-small` (1536-dim), but
  it's more than enough for single-document resume retrieval.

### 3. Vector store — `vector-store.ts`

A FAISS `IndexFlatIP` (flat, exact inner-product search) is built **per
session** and held in memory, mirroring the existing in-memory session store.

- `buildIndex`: embeds all chunks and adds them as one flat array
  (`faiss-node` expects `n * dim` numbers in a single array).
- `semanticSearch`: embeds the query the same way, runs `index.search(query, k)`,
  and maps the returned labels (insertion indices) back to the chunk text,
  returning each with its similarity score.
- **Why `IndexFlatIP` (exact) rather than an approximate index (HNSW/IVF)?**
  A resume has only a handful of chunks; exact search is instant and has 100%
  recall. At scale (millions of vectors) you'd switch to an ANN index like
  HNSW, trading a little recall for a large speed gain — that's the key
  scaling lever.

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

The native modules are declared in `next.config.ts`:

```ts
serverExternalPackages: ["pdf-parse", "@xenova/transformers", "faiss-node"]
```

> Requires Node.js >= 20.9 (Next.js 16). On first run, the embedding model
> (~90 MB) downloads and is cached.

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
- **Persistent / multi-tenant vector store** — move from per-session in-memory
  FAISS to a persistent store and an ANN index for scale across many resumes.

## Glossary (quick reference)

- **Embedding** — a vector capturing meaning; close vectors ≈ similar text.
- **Cosine similarity** — angle-based similarity; equals inner product for
  normalized vectors.
- **top-k** — the k nearest chunks returned for a query.
- **ANN** — approximate nearest neighbor (HNSW/IVF); trades recall for speed at
  scale. This project uses exact flat search since the corpus is tiny.
- **Grounding** — constraining the model to answer only from retrieved context.
