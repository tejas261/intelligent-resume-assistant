# Avaamo Interview Prep — Fundamentals (Node.js · React · MySQL · Kafka)

Companion to the AI/RAG prep. Covers the **fullstack fundamentals** the JD calls
out: *"A NodeJS wizard, proficient with Express and React JS … strong with SQL
(MySQL), WebSockets and message queues."* Format is the same: question → what's
being probed → strong answer → trap follow-up. Tie everything back to your real
experience (the **Kafka notification microservice**, the **Node/Express/Next/
React** stack, **MySQL/Mongo/Postgres**).

**The golden rule (same as before):** *what did you choose, why, what broke, what
at scale.*

---

# 1. Node.js (the "wizard" bar — expect the most depth)

## Concepts to know cold

- **Single-threaded event loop + non-blocking I/O** (libuv under the hood).
- Event loop **phases**: timers → pending callbacks → poll → check
(`setImmediate`) → close. **Microtasks** (Promises, `process.nextTick`) run
*between* phases, before the next macrotask.
- **Async evolution**: callbacks → Promises → `async/await`.
- **Streams & buffers** (process data without loading it all into memory).
- **Scaling**: `cluster`, `worker_threads`, the difference between I/O-bound and
CPU-bound work.
- **Express**: middleware chain, routing, centralized error handling.

---

**Q1. Node is single-threaded — how does it handle thousands of concurrent requests?**
*(Probing: do you actually understand the event loop, or just use it?)*

**Answer:** Node runs your JavaScript on one thread, but I/O (disk, network, DB)
is **non-blocking** — it's offloaded to libuv (and the OS / a thread pool), and
when it completes a callback is queued back onto the event loop. So while one
request waits on the database, the single thread is free to start handling the
next. Concurrency comes from *not blocking on I/O*, not from threads. This is why
Node is excellent for I/O-heavy workloads (APIs, proxies, chat) and weak for
CPU-heavy ones.

**Trap:** *"So what happens if you do a heavy `for` loop or sync crypto in a
request handler?"* → It **blocks the entire event loop** — every other request
stalls until it finishes, because there's one thread for JS. Fix: offload CPU
work to `worker_threads`, a child process, or a queue; never do synchronous
heavy compute on the request path.

---

**Q2. Explain the event loop phases. What prints first — `setTimeout(fn,0)` or `setImmediate(fn)` or `Promise.then`?**

**Answer:** `**Promise.then` first** — microtasks drain before the loop moves to
the next phase. Between `setTimeout(0)` and `setImmediate`, order isn't
guaranteed from the main module (depends on timing), but inside an I/O callback
`setImmediate` always fires first (check phase comes right after poll). The key
point: **microtasks (Promises, `process.nextTick`) always beat macrotasks
(timers, immediates)**.

**Trap:** *"`process.nextTick` vs `Promise.then`?"* → `nextTick` runs *before*
the Promise microtask queue — it's even higher priority. Overusing `nextTick` can
**starve** the event loop (I/O never gets a turn).

---

**Q3. Callback hell → Promises → async/await. What does async/await actually do?**

**Answer:** `async/await` is syntactic sugar over Promises — `await` pauses the
async function and yields control back to the event loop until the Promise
settles, then resumes. It makes async code *read* sequentially without blocking.
Critical detail for performance: `**await` in a loop serializes** independent
operations. If they're independent, use `Promise.all` to run them concurrently:

```js
// slow: serial
for (const id of ids) await fetchUser(id);
// fast: concurrent
await Promise.all(ids.map(fetchUser));
```

**Trap:** *"What about error handling and `Promise.all` failing?"* → `try/catch`
around `await`; but `Promise.all` rejects on the **first** failure (lose the
rest). Use `Promise.allSettled` when you want all results regardless of
individual failures.

---

**Q4. How do you handle errors robustly in an Express app?**

**Answer:** (1) Wrap async route handlers so rejected Promises reach Express
(`express-async-errors`, or a `try/catch`/wrapper) — otherwise an async throw is
an **unhandled rejection**, not a 500. (2) A **centralized error-handling
middleware** (`(err, req, res, next)`) at the end of the chain that formats the
response and logs. (3) Distinguish operational errors (bad input → 4xx) from
programmer errors (bugs → 5xx). (4) A last-resort `process.on ('unhandledRejection')` / `uncaughtException` to log and exit cleanly (let the
process manager restart). **Never swallow errors silently** — a caught-and-
ignored error is worse than a crash because it hides the failure.

---

**Q5. What is Express middleware? Give the mental model.**

**Answer:** Middleware is a function `(req, res, next)` in an ordered pipeline.
Each one can read/modify `req`/`res`, end the response, or call `next()` to pass
control. It's how you compose cross-cutting concerns: logging, auth, body
parsing, rate limiting, CORS, error handling. Order matters — auth middleware
must run before the protected route; the error handler must be last.

**Trap:** *"How does auth middleware short-circuit?"* → It either calls
`res.status(401).json(...)` and **doesn't** call `next()`, or calls `next(err)`
to jump straight to the error handler.

---

**Q6. How do you scale a Node app across CPU cores / machines?**

**Answer:** One Node process uses one core, so to use a 4-core box you run
**4 processes** — via the `cluster` module or, in practice, **PM2** or container
replicas behind a load balancer. State must be externalized (Redis/DB) so any
process can serve any request — i.e. **stateless app tier**. For CPU-bound tasks
inside a process, use `worker_threads`. Horizontal scaling = more containers +
load balancer; this is the standard cloud pattern (and what I'd do on AWS
ECS/Fargate).

**Connect to your work:** this is exactly the in-memory-Map limitation from the
resume assistant — fine for one instance, breaks across replicas, fixed by
moving session/vector state to Redis/a shared store.

---

**Q7. Streams — when and why?**

**Answer:** Streams process data in **chunks** instead of buffering it all in
memory — essential for large files, uploads, or piping (e.g. read a file →
transform → HTTP response). They give constant memory usage regardless of data
size and lower time-to-first-byte. `pipe()` also handles **backpressure**
automatically (slows the source when the destination can't keep up). Relevant to
LLM apps: **token streaming** to the client is a stream.

---

**Q8. How would you add WebSockets to a Node app, and when over HTTP?**
*(JD explicitly lists WebSockets.)*

**Answer:** Use WebSockets for **bidirectional, low-latency, persistent**
connections — live chat, streaming LLM tokens, presence, notifications. HTTP is
request/response; WebSocket upgrades a connection so the **server can push**
without the client polling. In Node: `ws` or **Socket.IO** (adds reconnection,
rooms, fallbacks). For one-directional server→client streaming, **SSE** is
simpler. For a chat/agent UI I'd stream the answer over WS/SSE and send final
structured metadata as a closing event.

**Trap:** *"How do you scale WebSockets across instances?"* → Sticky sessions +
a **pub/sub backplane** (Redis adapter) so a message from a client on instance A
reaches subscribers on instance B.

---

**Q9. How do you find and fix a memory leak in Node?**

**Answer:** Symptoms: RSS grows over time, eventually OOM. Tools: `--inspect` +
Chrome DevTools heap snapshots (diff two snapshots to find retained objects),
`process.memoryUsage()`, clinic.js. Common causes: unbounded caches/Maps,
listeners never removed, closures holding large objects, global arrays that only
grow. Fix the root retention, add bounds/TTLs.

**Connect:** your session `Map` and FAISS store grow unbounded — in production
you'd add eviction/TTL (you already cap IndexedDB at 3 sessions, which shows the
instinct).

---

# 2. React (proficiency bar — plus Next.js since that's your stack)

## Concepts to know cold

- Components, props, one-way data flow.
- Hooks: `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`,
`useContext`.
- Rendering & reconciliation, the virtual DOM, **keys**.
- State: local vs lifted vs context vs external store.
- Performance: `React.memo`, memo hooks, code-splitting/lazy.
- Next.js: SSR/SSG/ISR, **Server vs Client Components**, App Router.

---

**Q10. What actually happens when state changes? Explain re-rendering and reconciliation.**

**Answer:** `setState` marks the component dirty; React re-runs the component
function to produce a new virtual DOM tree, **diffs** it against the previous one
(reconciliation), and applies the **minimal** set of real DOM mutations. Re-render
≠ DOM update — most re-renders produce no DOM change. A parent re-render
re-renders children by default unless they're memoized.

**Trap:** *"Why are `key`s important in lists?"* → Keys let React match elements
across renders to preserve identity/state and avoid re-creating DOM. Using array
**index** as key breaks on reorder/insert (state attaches to the wrong item) —
use a stable unique id.

---

**Q11. `useEffect` — what's it for, and what are the common bugs?**

**Answer:** It runs side effects *after* render (data fetching, subscriptions,
DOM work) and syncs them to the dependency array. Bugs: (1) **missing deps** →
stale closures (you read an old value). (2) **infinite loops** → setting state
that's in the dep array without a guard. (3) **race conditions** on fetches → an
old request resolves after a newer one; fix with a cleanup flag or `Abort Controller`. (4) effects that should've been **derived state** or event handlers
instead. Modern guidance: don't reach for `useEffect` by default — only for
*synchronizing with external systems*.

```js
useEffect(() => {
  let active = true;
  fetchData(id).then(d => { if (active) setData(d); });
  return () => { active = false; };   // ignore stale response
}, [id]);
```

---

**Q12. `useMemo` vs `useCallback` vs `React.memo` — when do you actually need them?**

**Answer:** `useMemo` caches a computed **value**; `useCallback` caches a
**function reference**; `React.memo` skips re-rendering a component if props are
shallow-equal. You need them to (a) avoid expensive recomputation, or (b) keep
stable references so memoized children don't re-render. **But don't sprinkle them
everywhere** — memoization has its own cost and most renders are cheap. Measure
first (React DevTools Profiler); optimize the hot path, not every component.

**Trap:** *"So why did you not use Redux/Zustand in the resume assistant?"* →
Because state was simple and local (a few hooks in one component); an external
store would add ceremony for zero benefit. I reach for a store when state is
shared widely, updated from many places, or needs middleware. Right-sizing state
management is a judgment call, not a default.

---

**Q13. Controlled vs uncontrolled components?**

**Answer:** Controlled = React state is the source of truth (`value` + `onChange`)
— predictable, validatable, but re-renders on each keystroke. Uncontrolled = the
DOM holds the value, read via `ref` — less code, fewer renders, good for simple
or perf-sensitive forms. Default to controlled for anything with validation/
dependent logic.

---

**Q14. How do you handle data fetching and loading/error states cleanly?**

**Answer:** Track the three states explicitly (loading / error / data) — never
just data. For anything non-trivial I'd use **React Query / SWR**: caching,
dedup, retries, background refetch, and they kill most `useEffect` fetch bugs.
Always handle the error branch in the UI (the JD values "catches their own
mistakes" — silent failures are a red flag).

---

**Q15. Next.js: Server Components vs Client Components, and SSR vs SSG vs ISR?**
*(You use Next 16 App Router — expect this.)*

**Answer:**

- **Server Components** (default in App Router) render on the server, ship **no
JS** to the client, and can directly access the backend/DB — great for data
fetching and smaller bundles. **Client Components** (`"use client"`) run in the
browser and are needed for state, effects, and interactivity (my chat UI).
- **SSR**: HTML built per request (fresh, personalized). **SSG**: built once at
build time (fastest, cacheable). **ISR**: SSG + periodic background
regeneration (fresh-ish without rebuilds).
- Pick by data freshness vs. speed: marketing page → SSG; dashboard → SSR; an
agent chat → client-interactive with server route handlers for the API.

**Connect:** in the resume assistant, the API routes are server-side (Node access
for `pdf-parse`, FAISS, the LLM SDK) and the chat is a client component for
interactivity — that split is exactly Server vs Client Components.

---

# 3. MySQL / SQL (the JD says MySQL specifically)

## Concepts to know cold

- Schema design, **normalization** (1NF–3NF) and when to denormalize.
- Keys: primary, foreign, unique; **indexes** (B-tree), composite, covering.
- **Query optimization** with `EXPLAIN`.
- **Joins** (inner/left/right) and the **N+1** problem.
- **Transactions, ACID, isolation levels, locking**.
- SQL vs NoSQL — when each.

---

**Q16. How do indexes work, and when does an index *hurt*?**

**Answer:** A B-tree index keeps column values sorted so lookups/range scans are
O(log n) instead of a full table scan. Huge for read-heavy `WHERE`/`JOIN`/
`ORDER BY` columns. Costs: every **write** must also update the index (slower
inserts/updates), and indexes take space. So index the columns you filter/join/
sort on, not everything. An index also won't help if the query can't use it
(e.g. a function on the column, leading wildcard `LIKE '%x'`, or low selectivity
like a boolean).

**Trap:** *"Composite index `(a, b)` — does a query on `b` alone use it?"* → No
(or poorly) — B-tree composite indexes are **left-prefix**: they serve
`a`, `a,b`, but not `b` alone. Order columns by how you query them (and by
selectivity).

---

**Q17. How do you debug a slow query?**

**Answer:** `EXPLAIN` (or `EXPLAIN ANALYZE`) to see the plan: is it a full table
scan vs index lookup, the join order, rows examined, and whether a temp
table/filesort is happening. Then: add/fix an index, rewrite the query (avoid
`SELECT `*, avoid functions on indexed columns), reduce examined rows, or
denormalize/cache if it's a structural problem. Measure with realistic data
volume — small dev tables hide scan problems.

---

**Q18. What's the N+1 problem and how do you fix it?**

**Answer:** You run 1 query for a list, then 1 query **per row** to fetch related
data → N+1 round trips, kills performance at scale. Fixes: a **JOIN**, a single
`WHERE id IN (...)` batch, or an ORM's eager-loading/`include`. It's the most
common ORM performance trap.

---

**Q19. Explain ACID and isolation levels. Which would you pick?**

**Answer:** **ACID** = Atomicity (all-or-nothing), Consistency (valid state
transitions), Isolation (concurrent txns don't corrupt each other), Durability
(committed = persisted). **Isolation levels** trade consistency for concurrency:

- *Read Uncommitted* → dirty reads (rarely used).
- *Read Committed* → no dirty reads (Postgres default).
- *Repeatable Read* → no non-repeatable reads (**MySQL/InnoDB default**).
- *Serializable* → full isolation, lowest concurrency.
Pick the lowest level that's still correct for the use case; raise it for
money/inventory-type invariants.

**Trap:** *"Phantom reads?"* → New rows matching a range appear between reads;
prevented at Serializable (InnoDB's Repeatable Read also mitigates via next-key
locking).

---

**Q20. When MySQL vs MongoDB? You've used both.**

**Answer:** **MySQL** when data is relational with clear schema and you need
joins, multi-row transactions, and strong integrity (users, orders, payments).
**MongoDB** when the shape is flexible/semi-structured, you read it as whole
documents, and you want easy horizontal scaling (event logs, content, varied
resume JSON). It's not either/or — **polyglot persistence** is normal: relational
for the integrity-critical core, document for flexible blobs, vector for
embeddings. In the resume assistant the structured `ResumeData` is naturally a
document; a production version would put users/sessions in Postgres/MySQL and
chunks in a vector store.

---

**Q21. How do you design a schema? Walk me through normalization vs denormalization.**

**Answer:** Start **normalized** (3NF) — each fact in one place, no duplication,
referential integrity via foreign keys. That prevents update anomalies. Then
**denormalize selectively** for read performance when joins become a measured
bottleneck (e.g. precompute a counter, duplicate a frequently-joined column),
accepting the cost of keeping copies in sync. Normalize for correctness first,
denormalize for speed with evidence — not preemptively.

---

# 4. Kafka / Message Queues (YOUR differentiator — you built one)

> The JD lists "message queues" and your resume has a **Kafka notification
> microservice**. This is a place to look strong. Know it deeply.

## Concepts to know cold

- **Why** a queue: decoupling, async processing, buffering/load-leveling,
resilience.
- **Topics → partitions → offsets**; **producers, consumers, consumer groups,
brokers**.
- **Delivery semantics**: at-most-once / at-least-once / exactly-once.
- **Ordering** (per-partition only).
- **Consumer groups & rebalancing**.
- **Idempotency, retries, dead-letter queues, backpressure**.
- Kafka vs RabbitMQ vs SQS.

---

**Q22. Why use a message queue at all? What did it buy you in your notification service?**

**Answer:** It **decouples** producer from consumer. The service that triggers a
notification just publishes an event and moves on; the notification workers
consume at their own pace. Benefits: (1) **async** — the producer isn't blocked
by slow delivery (email/SMS/push). (2) **load-leveling** — a traffic spike fills
the queue instead of overwhelming downstream. (3) **resilience** — if a consumer
is down, messages persist and are processed when it recovers. (4) **scalability**
— add consumers to process more in parallel. Without it, a burst of events or a
slow downstream would cascade back and take down the producer.

---

**Q23. Explain partitions, offsets, and consumer groups.**

**Answer:** A **topic** is split into **partitions** — the unit of parallelism
and ordering. Each message in a partition has a monotonic **offset**. A
**consumer group** is a set of consumers sharing the work: **each partition is
consumed by exactly one consumer in the group**, so max parallelism = number of
partitions. Different groups each get the full stream independently (pub/sub).
Consumers track their committed offset so they can resume after a restart.

**Trap:** *"You have 3 partitions and 5 consumers in one group — what happens?"*
→ 3 consumers each get a partition, **2 sit idle**. Parallelism is capped by
partition count, so you partition for your target concurrency.

---

**Q24. What ordering guarantees does Kafka give?**

**Answer:** **Ordering is per-partition, not per-topic.** Messages in one
partition are strictly ordered by offset; across partitions there's no global
order. So if you need ordering for a given entity (e.g. all events for one user),
you give them the **same partition key** so they land in the same partition.
Trade-off: strict global ordering means one partition = no parallelism.

---

**Q25. Delivery semantics — at-most-once vs at-least-once vs exactly-once. Which did you use?**

**Answer:**

- **At-most-once**: commit offset *before* processing — no duplicates, but you can
**lose** messages on crash.
- **At-least-once**: process *then* commit — never lose, but a crash between
process and commit causes **reprocessing (duplicates)**. This is the common
default and what I'd use for notifications.
- **Exactly-once**: Kafka supports it via idempotent producers + transactions,
but it's heavier and only within Kafka's boundaries.

Because at-least-once can duplicate, you make consumers **idempotent** — e.g. a
dedup key / "already sent this notification id" check — so reprocessing is safe.
**At-least-once + idempotent consumer** is the pragmatic, robust choice.

**This answer (knowing the duplicate tradeoff *and* the idempotency fix) is a
strong signal.**

---

**Q26. What's a consumer rebalance and why can it be a problem?**

**Answer:** When a consumer joins/leaves (scale, crash, deploy), Kafka
**reassigns partitions** across the group — a rebalance. During it, processing
pauses ("stop-the-world"), and if you haven't committed offsets you can reprocess.
Frequent rebalances (e.g. slow processing causing missed heartbeats → consumer
considered dead) hurt throughput. Mitigations: tune session/heartbeat timeouts,
keep processing fast or commit periodically, use cooperative rebalancing.

---

**Q27. A message keeps failing. How do you handle retries without blocking the queue?**

**Answer:** Retry with backoff a few times; if it still fails, route it to a
**dead-letter queue (DLQ)** so it doesn't block the partition (head-of-line
blocking) and can be inspected/replayed later. Make handlers **idempotent** so
retries are safe. Alert on DLQ growth. Never infinitely retry a poison message in
place — it stalls everything behind it.

---

**Q28. Kafka vs RabbitMQ vs SQS — when each?**

**Answer:** **Kafka** = high-throughput, durable, replayable **event log**;
great for streaming, event sourcing, many consumers re-reading history; you keep
data and consumers track offsets. **RabbitMQ** = traditional message broker, rich
routing, per-message ack, good for task queues/RPC. **SQS** = fully managed, dead
simple, infinite scale, but no ordering (standard) / lower throughput (FIFO) and
no replay. Choose Kafka when you need throughput + replay + multiple independent
consumers (e.g. an event backbone); SQS when you want zero-ops on AWS.

---

**Q29. (Crossover to the AI role) How would Kafka fit an LLM/RAG system at scale?**
*(This connects your strongest fundamental to Avaamo's domain — gold.)*

**Answer:** Document ingestion for RAG is the perfect queue use case. Uploads
publish to a topic; **worker consumers** do the heavy, slow work off the request
path — extract → chunk → **embed** → upsert into the vector DB. Benefits: the API
stays fast, you absorb bursts, you scale embedding workers independently, and
failed docs go to a DLQ for retry. You can also stream agent/tool events through
Kafka for **observability**. This is exactly how I'd evolve the resume
assistant's synchronous `ingestResume` into an async pipeline at scale — and it's
where my Kafka experience meets their RAG-at-scale problem.

---

# 5. System-design crossovers (be ready to whiteboard)

**Q30. Design a notification system (your resume project, leveled up).**

**Sketch:** API receives a trigger → validates → **publishes event to Kafka**
(partitioned by user for ordering) → consumer groups per channel (email/SMS/push)
→ each worker calls the provider with retries → failures to **DLQ** → idempotent
sends via a dedup store → status persisted in MySQL → metrics/alerts. Talk about
ordering (partition key), at-least-once + idempotency, backpressure, and scaling
consumers.

**Q31. Design a REST API for the resume assistant (relational + document + vector).**

**Sketch:** `POST /resumes` (upload → queue ingestion), `GET /resumes/:id`,
`POST /sessions`, `POST /sessions/:id/messages` (the agent call). Auth middleware,
input validation (Zod), rate limiting, pagination, idempotency keys on uploads.
Storage: Postgres/MySQL (users, sessions, messages), Mongo (parsed resume JSON),
vector DB (chunks). Stateless app tier behind a load balancer; Redis for
sessions; async ingestion via queue.

---

# 6. Behavioural / connective tissue

- **"Tell me about a system you're proud of."** → The Kafka notification service.
Lead with the problem (decoupling + reliable delivery under bursts), the design
(partitions, at-least-once + idempotency, DLQ), and the outcome.
- **"Full stack" depth:** be ready to follow one feature end-to-end — React
component → API route → DB/queue → back to UI. They want someone who "holds the
whole system in their head."
- **Testing (JD: "automated testing"):** Jest for units (pure functions, tools),
Supertest for API routes, React Testing Library for components, Playwright for
E2E. Test behavior, not implementation; mock the LLM/DB at boundaries.

---

# 7. Pre-interview checklist (fundamentals)

- Event loop: can explain non-blocking I/O + why CPU work blocks it.
- `Promise.all` vs serial `await`; `allSettled` for partial failure.
- Express middleware order + centralized error handling.
- React: re-render vs DOM update, keys, `useEffect` race-condition cleanup.
- Server vs Client Components (you use Next App Router).
- Indexes: B-tree, composite left-prefix rule, when an index hurts.
- ACID + isolation levels; N+1 and the fix.
- Kafka: partitions/offsets/consumer groups; ordering is per-partition.
- At-least-once + idempotency (know the duplicate tradeoff cold).
- Can connect Kafka → async RAG ingestion at scale.

