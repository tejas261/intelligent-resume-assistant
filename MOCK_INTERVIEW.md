# Mock Interview — Intelligent Resume Assistant (AI Architect round)

This is a simulated deep-dive interview for the **Avaamo AI Engineer (Fullstack)**
role, conducted as if by an **AI Architect**. It is deliberately adversarial:
each question states what is really being probed, the expected answer grounded
in *your* code, the follow-up trap the architect will spring, and — where it
matters — the weakness you should own before they find it.

**How to use this:** cover the answers, read a question aloud, answer it out
loud, then check. The goal is fluency, not memorisation. Architects can tell the
difference instantly.

**The golden rule for every answer:** *what did you choose, why, what broke,
and what would you do at scale.* Four beats. Practise hitting them.

---

## A. Project snapshot (know this cold)

- **What it is:** an agentic resume assistant. Upload a PDF/TXT/paste → `pdf-parse`
  extracts text → Llama 3.3 70B (via Groq, OpenAI-compatible SDK) structures it
  into `ResumeData` → user chats → an agent with **4 tools** answers in a
  Zod-validated structured output `{ answer, confidence, source, missing_data }`.
- **RAG layer (added recently):** resume text → overlapping chunks
  (`chunker.ts`) → local embeddings `all-MiniLM-L6-v2`, 384-dim, normalized
  (`embeddings.ts`, via `@xenova/transformers`) → **FAISS `IndexFlatIP`**,
  per-session, in-memory (`vector-store.ts`) → exposed to the agent as a
  `semantic_search` tool with a relevance threshold of **0.25** for grounding.
- **Eval:** `eval.ts` golden set, hit-rate metric. Tuning chunk size 120→45 took
  it from **5/7 (71%) → 7/7 (100%)**; the out-of-scope question returns nothing
  (top score 0.082 < 0.25).
- **Stack:** Next.js 16 (App Router), TypeScript, Zod, IndexedDB (client
  persistence), in-memory `Map` (server sessions).
- **Honest gaps:** single short document (RAG is "toy-scale"), no reranking, no
  hybrid search, no streaming/WebSockets, no persistent/multi-tenant vector
  store, embeddings are a small model, no auth, no observability.

---

## B. Warm-up & framing

**Q1. Walk me through your project in two minutes.**
*(Probing: can you communicate architecture crisply and lead with the problem,
not the tech — their #1 listed trait.)*

**Expected:** Start with the problem ("a recruiter needs reliable, grounded
answers about a candidate, not a chatbot that makes things up"), then the flow
(upload → structure → agentic chat with tools → grounded, structured answers),
then the reliability story (guardrails, confidence/source, RAG grounding, evals).
End with one honest limitation. Don't list libraries — describe decisions.

**Trap follow-up:** *"You said 'agentic' — what specifically makes it an agent
and not a chatbot?"* → Five things: a constrained role, **autonomous tool
selection** (the LLM decides which of the 4 tools to call), context/memory across
turns, self-guardrails (refuses, reports `missing_data`), and a structured-output
contract. The keystone is tool autonomy.

---

**Q2. Why did you add RAG when the resume already fits in the context window?**
*(Probing: do you understand RAG's purpose, or did you bolt it on for buzzwords?)*

**Expected:** Be honest — for a *single short* resume, stuffing it in the prompt
is fine, and RAG is arguably overkill. RAG earns its place the moment you (a)
have **many** documents (a candidate pool, an enterprise knowledge base), (b)
have **long** documents that blow the context window or trigger lost-in-the-
middle, or (c) want **citeable, grounded** retrieval to control hallucination
and cost. I added it because the role is RAG-at-scale, and I wanted retrieval
that the agent *chooses* per query and that grounds the guardrail. The
architecture now scales to a multi-resume corpus by changing the store, not the
agent.

**Weakness to own:** "On one resume the absolute eval numbers are easy — the
value shows once you ingest a pool, which is my next step."

---

## C. RAG fundamentals (expect the most depth here)

**Q3. Explain your RAG pipeline end to end. What happens to a query?**

**Expected:** Ingestion (once per resume): text → `chunkText` (overlapping word
windows) → `embedBatch` (MiniLM, 384-dim, mean-pooled, normalized) → added to a
FAISS `IndexFlatIP` keyed by session. Query time: the agent calls
`semantic_search(query)` → the query is embedded the *same way* → FAISS inner-
product search returns top-k → chunks below the 0.25 threshold are dropped → the
survivors (text + score) are returned to the LLM as a tool result → the LLM
answers grounded in them, or says "Not mentioned" if nothing survived.

**Trap:** *"Why embed the query with the same model as the documents?"* →
Because similarity is only meaningful within one vector space. Query and document
vectors must come from the same model/space or the geometry is meaningless.

---

**Q4. What is an embedding, concretely?**

**Expected:** A dense fixed-length vector (here 384 floats) that places text in a
space where semantic similarity ≈ geometric closeness. "Node.js backend" lands
near "Express server" and far from "watercolour painting." It's learned, not
keyword-based — that's why it catches paraphrases that string search misses.

**Trap:** *"Then why keep your keyword tools (`match_skills`, `extract_keywords`)
at all?"* → Because embeddings are *bad* at exact-token precision. "Does he know
Kubernetes specifically?" wants an exact match, not a semantic neighbour. The
agent picks: `semantic_search` for fuzzy/conceptual, keyword tools for exact.
That's the argument for **hybrid search** in production.

---

**Q5. Cosine similarity vs. inner product vs. Euclidean (L2) — which did you use and why?**
*(Probing: do you actually understand your own index choice, or did you copy it?)*

**Expected:** I use **inner product** (`IndexFlatIP`). Because I L2-**normalize**
every embedding (`normalize: true` in the pooling step), inner product equals
**cosine similarity** — they're identical for unit vectors. Cosine is the right
metric for text because it measures *direction* (meaning), not magnitude (length
/ verbosity). If I hadn't normalized, IP would be skewed by vector length and I'd
want L2 or explicit cosine instead.

**Trap:** *"Prove IP = cosine for normalized vectors."* → cosine = (a·b)/(‖a‖‖b‖);
if ‖a‖=‖b‖=1 the denominator is 1, so cosine = a·b = inner product. My smoke
test showed exactly this: identical vectors → 1.0, orthogonal → 0.0.

---

**Q6. Walk me through chunking. What size, what overlap, and why those numbers?**

**Expected:** Fixed-size **word-window** chunks with overlap (app default
size 120 / overlap 20). Overlap exists so a skill or sentence that lands on a
boundary survives intact in at least one chunk. Size is a tradeoff: bigger =
more context but **diluted** similarity (the vector averages too many topics);
smaller = sharper retrieval but risk losing surrounding context and more chunks.
I don't treat the numbers as sacred — I **tuned them with the eval**.

**Trap (this is the strong one — volunteer it):** *"How do you know 120 is good?"*
→ I didn't guess and ship. My eval scored **71%** at size 120 on the sample —
the short resume collapsed into one chunk, diluting similarity so "which
databases?" fell below threshold. Dropping to 45 split it into 3 chunks and the
score went to **100%**. That's a measured decision, not a vibe.

**Better-answer upgrade:** "Fixed-size is the naive baseline. For resumes I'd
move to **section-aware** chunking — split on EXPERIENCE/SKILLS/EDUCATION headers
— so chunks align with meaning instead of arbitrary word counts."

---

**Q7. How do you pick top-k? What breaks if k is too small or too large?**

**Expected:** k is a recall/precision-and-cost knob. Too small → you miss the
relevant chunk (recall drops, the model says "not mentioned" wrongly). Too large
→ you stuff noise into the prompt, raising cost/latency and inviting the model to
latch onto an irrelevant chunk (lost-in-the-middle). I use a small k (3–4) plus a
**relevance threshold** so weak matches are dropped even within top-k. Ideal k is
tuned on the eval, not assumed.

---

**Q8. Fine-tuning vs. RAG — when would you fine-tune instead?**

**Expected:** RAG for *knowledge* that's fresh, private, large, or needs
citations — you can update the index without retraining. Fine-tune for *behaviour
/ format / style* the model should internalise (tone, a strict output shape, a
domain dialect). They're complementary: RAG supplies facts, fine-tuning shapes
how the model uses them. For a resume Q&A tool, RAG is correct — the knowledge
changes per upload; there's nothing to bake into weights.

---

## D. FAISS & the vector store (code-grounded)

**Q9. Why FAISS `IndexFlatIP` specifically? Why not an approximate index?**
*(Probing: do you know the exact-vs-approximate tradeoff — the core scaling lever.)*

**Expected:** `IndexFlatIP` is a **brute-force, exact** index — it scores the
query against every vector. For a resume's handful of chunks that's instant and
gives 100% recall, so approximation would only add complexity and risk. At scale
(hundreds of thousands to millions of vectors) brute force is O(n) per query and
too slow, so you switch to an **ANN** index — **HNSW** (graph-based, great
recall/latency, higher memory) or **IVF/IVFPQ** (cluster + optionally quantize,
lower memory). The trade is a little recall for a large speed/memory win. Knowing
*when* to make that switch is the point.

**Trap:** *"What's the recall cost of HNSW and how do you control it?"* → It's
approximate, so it can miss true neighbours; you tune `efSearch`/`efConstruction`
(and `M`) to trade latency for recall, and you'd measure the recall hit on your
eval before shipping.

---

**Q10. Where exactly are the vectors stored, and what's the lifetime?**

**Expected:** In process memory. Two places, both keyed by `sessionId`: the
**vectors** live inside the FAISS index object (C++ side of `faiss-node`); the
**chunk text + index handle** live in a module-level `Map` in `vector-store.ts`.
Nothing is persisted to disk except the embedding model cache (~90 MB, once).
It's **ephemeral** — gone on server restart, exactly like the in-memory session
`Map`. That's why `/api/restore` re-ingests when a client reloads a saved
session (and falls back to `resumeToText()` because the client doesn't persist
`raw_text`).

**Trap:** *"So what happens with two server instances behind a load balancer?"*
→ It breaks — each instance has its own `Map`, so a request routed to instance B
won't find the index built on instance A. Fixes: sticky sessions (band-aid) or,
properly, a **shared external vector store** (pgvector/Pinecone/Weaviate/Qdrant)
and a shared session store (Redis). The agent logic is already stateless per
request, so only the storage layer changes.

---

**Q11. The model takes ~20–30s to load and your eval hung on Node 20.0.0. Talk me through that.**
*(Probing: operational honesty + debugging.)*

**Expected:** The MiniLM model loads once (singleton) and is cached; first call
pays the load cost, later calls are fast — that's why the singleton matters
(reloading per request would be brutal). The hang was environmental: the active
nvm Node (20.0.0) doesn't play well with `@xenova/transformers` + tsx; it ran
cleanly on Node 22/25. Lesson: pin a known-good Node version. In production I'd
also move embedding to a warm service so request latency never includes a cold
model load.

---

## E. The agent loop & tool integration

**Q12. How does the tool-calling loop work, and how does `semantic_search` fit in?**

**Expected:** `agent.ts` builds the message array (system prompt + resume +
history + new message), sends it with all 4 tool definitions. If the model
returns `tool_calls`, I execute each (now **async**, because retrieval embeds +
searches), append results as `role: "tool"` messages, and loop — capped at
**MAX_TOOL_ITERATIONS = 3** to prevent runaway calls. After the cap, one final
call *without* tools forces the structured answer. `semantic_search` is just a
4th tool the model can choose; I added it alongside the three deterministic ones
so the model picks retrieval strategy per question.

**Trap:** *"Who decides whether to use `semantic_search` vs `search_resume_section`?
What if it chooses wrong?"* → The LLM decides, guided by the tool descriptions
(semantic for fuzzy/conceptual; section lookup for a known section). It can
choose wrong — mitigations are sharper tool descriptions, few-shot examples, and
the eval to catch systematic mis-routing. At scale you'd consider a router/
planner step or constrain tool availability by intent.

---

**Q13. Your tool loop is capped at 3. Why 3? What's the failure mode?**

**Expected:** It's a safety bound against infinite tool loops and runaway cost/
latency. 3 is enough for realistic multi-tool answers here. Failure mode: a
genuinely complex query that needs more steps gets cut off — then the forced
final call may answer with incomplete tool data. Mitigation: make it adaptive
(stop when the model signals done), or raise the cap with a token/time budget
instead of a fixed count.

---

**Q14. You inject tool results as messages and replay full history every turn. What's the cost?**
*(Probing: context-window economics.)*

**Expected:** It's simple and gives full multi-turn context, but it grows
unbounded — every turn re-sends the system prompt, full resume, and all prior
messages, so tokens (and cost/latency) climb with conversation length. I cap
`raw_text` at 8000 chars to bound the prompt. Production fixes: a **sliding
window** over history, **summarisation** of older turns, or — fittingly — RAG
over the conversation itself so only relevant history is retrieved.

---

## F. Guardrails, grounding & hallucination

**Q15. How do you stop the model from hallucinating? Be specific.**

**Expected:** Layered. (1) **Grounding** — answers must come from resume data /
retrieved chunks, instructed in the system prompt. (2) **Retrieval-grounded
guardrail** — `semantic_search` only returns chunks above the **0.25** threshold;
if nothing clears it, the tool returns an explicit "no relevant passages" note
and the prompt tells the model to say "Not mentioned in resume" and fill
`missing_data`. (3) **Source attribution** — every answer declares `resume` vs
`inference`, plus a confidence score, so provenance is visible. The eval's
negative case verifies the guardrail (out-of-scope query → 0.082, nothing
returned).

**Trap (own this):** *"0.25 is arbitrary. Defend it. What if it's wrong?"* → It's
an empirically chosen floor, validated against the eval — above ~0.3 I started
getting false "not mentioned" answers; too low lets noise through and the model
hallucinates *from retrieved-but-irrelevant* text, which is worse. It's
corpus/model-dependent and should be tuned per dataset, ideally with a
precision/recall sweep on a larger eval. I'd also prefer a **reranker** over a
single scalar threshold for the final cut.

---

**Q16. A user asks "What's the candidate's salary expectation?" — trace what happens.**

**Expected:** The model (likely after `semantic_search` returns nothing above
threshold, or directly from grounding) returns
`{ answer: "Not mentioned in resume…", confidence: 0.0, source: "resume",
missing_data: ["salary expectation"] }`. The UI renders a red confidence bar and
a "not in resume" indicator. The point: **missing data is surfaced as a feature,
not faked.**

---

**Q17. RAG itself can hallucinate even with retrieval. How?**

**Expected:** Yes — three ways. (1) **Retrieval miss**: the right chunk isn't
retrieved, so the model answers from parametric memory. (2) **Irrelevant-but-
above-threshold** chunks: the model grounds on the wrong passage. (3) **Faithful-
to-context but context-is-wrong**: garbage in the source. Mitigations: better
retrieval (hybrid + rerank), strict "answer only from context, else refuse"
prompting, citation/quote requirements, and **faithfulness evals** (does the
answer actually follow from the retrieved text — e.g. an LLM-as-judge check).

---

## G. Evals (your differentiator — lean in)

**Q18. How do you know your retrieval is any good?**
*(This is THE question most candidates fail. The JD names "evals" twice.)*

**Expected:** I measure it. `eval.ts` is a golden set of `{question,
expected-markers}` plus a negative case; it runs each through `semanticSearch`
and reports a **hit-rate** (did the right chunk make top-k). It caught a real
regression: 71% at chunk size 120 because the doc collapsed to one chunk; fixing
chunking took it to 100%. So I tune chunk size, threshold, and k against a number,
not vibes — and I catch regressions when I change any of them.

**Trap:** *"Hit-rate measures retrieval. How would you measure answer quality?"*
→ Separate the two: **retrieval metrics** (recall@k, MRR, nDCG) and **generation
metrics** (faithfulness/groundedness, answer relevance) — the latter via
LLM-as-judge or human labels. Frameworks: RAGAS, or Langfuse/LangSmith for
tracing. I'd also add **regression gating** in CI so a prompt or chunking change
can't silently drop quality.

**Weakness to own:** "My eval is one short resume — the absolute numbers are easy.
The next step is a multi-resume eval set where retrieval is genuinely hard."

---

**Q19. What metrics matter for retrieval, and what's the difference between recall@k and MRR?**

**Expected:** **Recall@k** — is the relevant chunk anywhere in the top-k (coverage).
**MRR/nDCG** — does it rank *high* (position quality). For RAG feeding an LLM,
recall@k matters most (if it's in the window, the LLM can use it), but ranking
matters for small k and for lost-in-the-middle. My current eval is essentially
recall@k with k=3.

---

## H. Reliability & structured output

**Q20. Why enforce structured output via prompt + Zod instead of the provider's `response_format`/json_schema?**

**Expected:** Two reasons. (1) Portability — not every OpenAI-compatible endpoint
supports strict `json_schema`, *especially combined with tool calling*, and I
need both. Prompt + Zod works on any provider. (2) Zod is a runtime **safety net**
— TypeScript types vanish at compile time and can't catch a malformed LLM
response; Zod validates types, the 0–1 confidence range, and the source enum at
runtime. On parse failure I construct a valid fallback so the frontend never
receives a broken shape.

**Trap:** *"What's the failure rate and what's the blast radius?"* → ~1% don't
return clean JSON; `parseStructuredOutput` strips markdown fences, then falls
back to raw text with confidence 0.5 and a `missing_data` flag. Blast radius is
contained — degraded answer, never a crash. With native structured output I'd cut
that 1% further.

---

**Q21. Confidence is self-reported by the model. Isn't that unreliable?**

**Expected:** Correct — LLM self-confidence is weakly calibrated; it's a UX
signal, not a guarantee. I bound it (Zod 0–1) and define what each band means in
the prompt, but I wouldn't gate critical decisions on it. Better calibration:
derive confidence from **retrieval scores** (how strong was the grounding),
ensemble/self-consistency, or a separate judge — rather than trusting the
generator's introspection.

---

## I. Architecture & scaling (Avaamo cares: RAG at scale, multi-agent, MCP)

**Q22. Take this from one resume to 10 million documents across many tenants. What changes?**

**Expected:** The agent stays; the **storage and retrieval** layer changes.
(1) Swap in-memory FAISS for a **persistent, multi-tenant vector DB** (pgvector/
Pinecone/Weaviate/Qdrant) with an **ANN index** (HNSW/IVF). (2) **Tenant
isolation** via metadata filtering or per-tenant namespaces/indexes. (3)
**Async ingestion pipeline** — a queue (this is where my **Kafka** experience
fits) so chunk+embed happens off the request path; embeddings as a batched,
warm service. (4) **Caching** of frequent queries/embeddings. (5) **Hybrid
search + reranking** for quality at scale. (6) **Observability** — trace
retrieval and tool chains (Langfuse/LangSmith). (7) Redis for sessions, stateless
app tier behind a load balancer.

**Trap:** *"What's the bottleneck first — embedding or search?"* → Usually
ingestion/embedding throughput and index build/memory, before query latency.
That's why ingestion goes async and the index type/quantization (IVFPQ) becomes a
memory decision.

---

**Q23. Avaamo is multi-agent. How would you extend this single agent into an orchestrated system?**

**Expected:** Introduce specialised agents behind an **orchestrator/router**: e.g.
a retrieval agent, a skills-matching agent, a comparison agent (rank candidates),
each with its own tools. The orchestrator decomposes the request, routes to
sub-agents (in parallel where independent), and synthesises. Model it as a graph
(à la LangGraph, which I've used) with explicit state. Key concerns: shared
memory/context passing, avoiding infinite agent-to-agent loops (budgets), and
**per-agent evals** so reliability is measurable at each hop, not just end-to-end.

---

**Q24. What is MCP and where would it fit here?**
*(Probing: are you current? It's a JD nice-to-have and a likely architect probe.)*

**Expected:** MCP (Model Context Protocol) is an open standard for connecting
LLMs to tools/data via **MCP servers** — think "USB-C for tools": you implement a
connector once and any MCP-aware agent can use it, instead of bespoke
function-calling glue per app. Here, I'd expose `semantic_search` (and an ATS or
calendar connector) as an **MCP server**, so the same retrieval tool is reusable
across Avaamo's agents rather than hard-wired into this one. It standardises the
"connector-based tool integration" the JD mentions.

---

**Q25. If you rebuilt this for production reliability, what are your top 3 changes?**

**Expected:** (1) **Retrieval quality**: hybrid search + reranking + a real
multi-doc eval with CI gating. (2) **Persistence & scale**: external vector DB +
Redis + async embedding pipeline. (3) **Observability**: structured tracing of
every LLM call, tool chain, latency, tokens, and retrieval scores — you can't
improve agent reliability you can't see. (Honorable mention: streaming for UX,
auth for multi-tenant.)

---

## J. Fullstack & system design (don't neglect — it's a *fullstack* role)

**Q26. The JD wants WebSockets / streaming chat. You don't have it. Why, and how would you add it?**
*(Probing: do you know your own gap and the real tradeoff?)*

**Expected:** I deliberately don't stream because my output is a **Zod-validated
JSON contract** — partial JSON is unusable and validates only when complete. The
honest tradeoff: I chose reliability over perceived latency (2–5s with a thinking
indicator). To add streaming without losing the contract: stream the human-facing
**`answer` prose** token-by-token over **WebSockets/SSE**, then send the
structured metadata (`confidence`, `source`, `missing_data`) as a final
validated event. Tool-calling complicates it (you'd stream status: "searching
resume…"), which is itself good UX. In Next I'd use a route handler with an
upgrade or a separate WS server; client uses `RTCPeerConnection`/`WebSocket`.

**Weakness to own:** say plainly you haven't built it yet but can reason about it
— matches their "working knowledge, learns fast" bar.

---

**Q27. Design the database schemas — relational, document, and vector — for the production version.**
*(JD explicitly: "design relational, non-relational, and vector schemas.")*

**Expected:**
- **Relational (Postgres):** `users`, `resumes(id, user_id, name, raw_text_ref,
  created_at)`, `sessions(id, user_id, resume_id, created_at)`,
  `messages(id, session_id, role, content, structured jsonb, created_at)` — for
  integrity, joins, auth.
- **Document (Mongo):** the parsed `ResumeData` JSON (variable shape: skills[],
  experience[], education[]) — flexible schema fits semi-structured resumes.
- **Vector (pgvector/Pinecone):** `chunks(id, resume_id, tenant_id, text,
  metadata jsonb, embedding vector(384))` with an HNSW index and metadata
  filtering by `tenant_id`/`resume_id`.

Tie it together: structured data in Mongo/Postgres for exact lookups
(`match_skills`), vectors for semantic retrieval — which is exactly the
dual-path my `semantic_search` + keyword tools already model.

---

**Q28. You deploy on AWS (the JD says so). Sketch it.**

**Expected:** App tier (Next.js) on ECS/Fargate or Lambda behind ALB; Redis
(ElastiCache) for sessions; Postgres (RDS) + a managed/​self-hosted vector store;
an **SQS/Kafka** queue + worker for async resume ingestion (extract→chunk→embed);
S3 for raw files; secrets in Secrets Manager; CloudWatch + an LLM-tracing tool
for observability; autoscaling on the stateless app tier. Dev/staging/prod via
IaC.

---

**Q29. Why Next.js App Router instead of a separate Express backend?**

**Expected:** One codebase, shared TypeScript types across client/server (no
contract drift via `src/types`), API route handlers run server-side with full
Node access (needed for `pdf-parse`, the OpenAI SDK, FAISS), no CORS, one deploy.
For this scope it removes accidental complexity. If the backend grew heavy or
needed to scale independently of the UI, I'd split it — but I wouldn't pay that
cost prematurely.

---

## K. Adversarial gotchas (the ones that separate candidates)

**Q30. Your eval is 100% — so retrieval is solved, right?**
*(Trap: testing humility + statistical sense.)*

**Expected:** No — 7/7 on one short resume is a smoke test, not a quality bar.
Small n, easy corpus, markers I wrote myself. It proves the pipeline works and
catches regressions; it does **not** prove production quality. Real confidence
needs a larger, harder, multi-document eval with recall@k and faithfulness, ideally
human-validated. A green eval that's too easy is a false sense of security.

---

**Q31. Two resume chunks are near-duplicates. What happens, and is that a problem?**

**Expected:** Both score high and can occupy top-k, wasting the budget on
redundant context and crowding out a different relevant chunk — hurting answer
completeness. Fixes: **dedup** at ingestion, **MMR** (maximal marginal relevance)
at retrieval to trade pure similarity for diversity, or a reranker that penalises
redundancy.

---

**Q32. The candidate's resume says "led a team"; user asks about leadership. Walk the retrieval and the `source` field.**

**Expected:** `semantic_search("leadership")` retrieves the "led a team" chunk
(semantic match even without the word "leadership" — my eval's mentor case shows
this). The answer is grounded in the resume, so `source: "resume"`, high
confidence. If instead the user asked "is he a good leader?" — that's a judgment
not stated → `source: "inference"`, lower confidence, and ideally a caveat. The
resume/inference split exists exactly for this line.

---

**Q33. MiniLM is a small 384-dim model. Defend it or replace it.**

**Expected:** Defend for this scope: local, free, no API key (Groq doesn't serve
embeddings), fast, and plenty for single-resume retrieval — my eval confirms it
discriminates well. Replace when quality matters at scale: a larger model
(`text-embedding-3-small/large`, 1536+ dims) captures finer semantics and
multilingual nuance (relevant — Avaamo is multilingual), at the cost of API
dependency, latency, and money. I'd A/B the two **on the eval** before switching,
not on faith.

---

**Q34. Where could this leak data or violate compliance? (Avaamo is enterprise/healthcare/compliance-heavy.)**

**Expected:** Resumes are PII. Risks: sending text to a third-party LLM (data
residency/retention — need a BAA/zero-retention or self-hosted model for
healthcare), PII in logs (I currently log full payloads — must redact), no auth
or tenant isolation yet (cross-tenant retrieval leakage if multi-tenant), and
embeddings can themselves leak content (treat the vector store as sensitive).
Mitigations: redaction, encryption at rest/in transit, per-tenant isolation,
audit logging, and a compliant model deployment. Good that I keep embeddings
local — that's a data-minimisation win.

**This answer scores big** — it shows you think about *their* domain, not just code.

---

**Q35. What's the single biggest weakness of your current design?**

**Expected (pick one and own it fully):** "Retrieval quality is unproven beyond a
toy corpus — single short document, no reranking, no hybrid search, a hand-tuned
threshold. It works and it's measured, but I wouldn't trust it at scale without a
real multi-document eval, hybrid retrieval, and a reranker. That's exactly where
I'd invest next." Confident ownership of a real limitation reads as senior;
pretending there isn't one reads as junior.

---

## L. Behavioural / role-fit (they screen for these traits explicitly)

**Q36. Tell me about something that broke and how you debugged it.**
→ The eval hang on Node 20.0.0 / the 71%→100% chunking fix. Show the loop:
observed a number, formed a hypothesis (one chunk diluting similarity), tested
(re-chunk), confirmed (score moved). That's "learns from what breaks."

**Q37. How do you use AI to ship faster?**
→ Be concrete and honest: agentic coding for scaffolding, tests, and exploration;
you in the loop reviewing and verifying. Matches their "agentic coding practices"
trait. Have one real example.

**Q38. You don't have 3 years / haven't done RAG at scale. Why you?**
→ Don't get defensive. "Working knowledge + learns fast is your bar. I shipped an
agent with tools and guardrails, then taught myself RAG and built it end-to-end
with FAISS and an eval in a weekend. Depth of ownership over years-on-paper."

---

## M. Questions YOU should ask them (asking good questions is scored)

- "How is your multi-agent orchestration structured — a single orchestrator with
  sub-agents, or a graph with shared state?"
- "How do you run evals and regression-gate agent behaviour at scale?"
- "Where does MCP sit in your connector strategy today?"
- "What's the hardest reliability problem in your production RAG right now —
  retrieval quality, latency, or hallucination?"
- "How do you handle data residency and PII for healthcare customers?"

---

## N. 60-second pre-interview checklist

- [ ] Can explain IP = cosine for normalized vectors in one breath.
- [ ] Can quote the eval story: 71% → 100%, why (chunking), threshold 0.25.
- [ ] Can state the in-memory/ephemeral limitation and the production fix.
- [ ] Can name the gaps before they do: hybrid search, reranking, multi-doc eval,
      streaming/WebSockets, multi-tenant store, observability.
- [ ] Have one concrete answer each for: a bug you fixed, using AI to ship, the
      biggest weakness.
- [ ] Node pinned to ≥22 so `npm run dev` / `build` / `eval:rag` all work live.
- [ ] Read one Avaamo customer story + the compliance page; have a reference ready.
```
