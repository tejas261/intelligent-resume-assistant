# Interview Prep — Resume Assistant (Agentic AI System)

This document covers every architectural decision, implementation detail, and trade-off in depth. Use it to answer any interview question about the system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Deep Dive](#2-architecture-deep-dive)
3. [Agentic Design Patterns](#3-agentic-design-patterns)
4. [Tool Use Implementation](#4-tool-use-implementation)
5. [Structured Output Enforcement](#5-structured-output-enforcement)
6. [Guardrails and Reliability](#6-guardrails-and-reliability)
7. [PDF Processing Pipeline](#7-pdf-processing-pipeline)
8. [Session and Context Management](#8-session-and-context-management)
9. [Frontend Architecture](#9-frontend-architecture)
10. [LLM Integration via Groq (Llama 3.3 70B)](#10-llm-integration-via-groq-llama-33-70b)
11. [Client-Side Persistence (IndexedDB)](#11-client-side-persistence-indexeddb)
12. [Design Decisions and Trade-offs](#12-design-decisions-and-trade-offs)
13. [What I Would Do Differently at Scale](#13-what-i-would-do-differently-at-scale)
14. [Common Interview Questions](#14-common-interview-questions)

---

## 1. System Overview

The Resume Assistant is an **agentic AI system** — not a chatbot. The distinction matters:

- A **chatbot** takes user input and returns LLM output.
- An **agentic system** has a defined role, uses tools to accomplish tasks, maintains context across interactions, enforces guardrails on its own behavior, and produces structured, reliable outputs.

The system does three things:

1. **Parses PDF resumes** into structured data (name, skills, experience, education)
2. **Answers questions** about candidates using that structured data
3. **Enforces reliability** — every response includes a confidence score, data source attribution, and a list of what information was missing

### End-to-End Flow

```
User uploads PDF/TXT or pastes text
    → pdf-parse extracts raw text (PDF) or file.text() (TXT/paste)
    → Llama 3.3 70B (via Groq) structures text into ResumeData (JSON)
    → Session created with UUID, stored in-memory + IndexedDB

User asks a question
    → Agent builds message array (system prompt + resume data + history + new message)
    → Llama 3.3 70B receives tools + messages
    → LLM decides: answer directly OR call tools first
    → If tools called: execute tool → feed result back → LLM answers
    → Response parsed with Zod schema → validated → returned as StructuredOutput
```

---

## 2. Architecture Deep Dive

### Why Next.js (App Router)?

Next.js is the optimal choice here because:

- **Single project**: Frontend + backend API routes in one codebase. No separate Express server. No CORS configuration. No separate deployment.
- **App Router**: The `/app/api/` convention gives us typed route handlers that run server-side with full Node.js access (needed for pdf-parse and OpenAI SDK).
- **TypeScript end-to-end**: Shared type definitions between API responses and React components via `src/types/index.ts`. No drift between frontend and backend contracts.
- **Edge-ready**: The API routes run as serverless functions on Vercel if deployed.

### File-Level Architecture

The codebase has three layers with strict separation:

**Layer 1 — Types & Schemas (`src/types/`, `src/lib/schemas.ts`)**
Pure data definitions. No imports from other layers. Zod schemas mirror TypeScript interfaces but add runtime validation (critical for LLM outputs that can be unpredictable).

**Layer 2 — Business Logic (`src/lib/`)**
All intelligence lives here. The `agent.ts` file is the core — it orchestrates the system prompt, tool calling loop, and output validation. `tools.ts` defines tool implementations. `session.ts` manages state. None of these files import from `components/` or `app/`.

**Layer 3 — API & UI (`src/app/`, `src/components/`)**
Thin wrappers. API routes parse request → call business logic → return response. Components display data and handle user interaction. No business logic in this layer.

This separation means you could swap the frontend to a mobile app or CLI and only touch Layer 3. You could swap the LLM provider and only touch `openai.ts`.

---

## 3. Agentic Design Patterns

### What Makes This "Agentic"?

Five characteristics separate this from a plain chatbot:

#### 3.1 Role Definition

The system prompt establishes a strict **hiring assistant** persona. The LLM cannot drift into being a general assistant, creative writer, or coder. The prompt explicitly constrains the LLM:

- "You analyze resumes and answer questions about candidates based ONLY on the data present in their resume"
- "Never fabricate or assume information not present in the resume"

#### 3.2 Tool Autonomy

The LLM decides when to use tools. When asked "Does this candidate know React?", it can:

- Answer from the resume data in its context (if the system prompt includes it), OR
- Call `match_skills(["React"])` to get a precise match/gap analysis

The choice is the LLM's. This is the "agentic" part — the system makes decisions about how to best accomplish the user's request.

#### 3.3 Context Management

Each session stores:

- Extracted resume data (structured)
- Full conversation history
- Each message's structured output metadata

This context is rebuilt on every chat request, so the LLM can reference prior answers, follow-up on topics, and maintain coherent multi-turn conversations.

#### 3.4 Guardrails

The system actively prevents hallucination:

- System prompt instructs: if data isn't in the resume, say "Not mentioned in resume"
- Every response includes `missing_data[]` — an explicit list of what the LLM could not find
- Confidence scores signal how much the LLM had to infer vs. directly cite

#### 3.5 Structured Output

Every response is a JSON object validated by Zod. This isn't optional formatting — it's a contract. The frontend relies on `confidence`, `source`, and `missing_data` fields existing with correct types.

---

## 4. Tool Use Implementation

### The Three Tools

**`search_resume_section(section)`**

- Input: `"skills" | "experience" | "education" | "summary" | "contact"`
- Output: Formatted string of the requested section
- Purpose: The LLM can fetch specific resume sections rather than relying on the full resume dump in the system prompt. This is especially useful if the resume is long and the context window might lose detail.

**`match_skills(required_skills)`**

- Input: Array of skill strings
- Output: `{ matched: string[], missing: string[], match_percentage: number }`
- Purpose: Precise skill gap analysis. Uses case-insensitive substring matching (so "react" matches "React.js"). This is a deterministic computation, not an LLM judgment.

**`extract_keywords(section, top_n)`**

- Input: Which section to analyze, how many keywords
- Output: Array of `{ keyword, count }` sorted by frequency
- Purpose: Identifies key themes, technologies, and domain expertise from raw text. Pure algorithmic tool — filters stop words, counts frequency, returns top N.

### Why These Three Specifically?

They demonstrate three different tool patterns:

1. **Data retrieval** (`search_resume_section`): Fetches structured data the LLM might need
2. **Computation** (`match_skills`): Performs a calculation the LLM shouldn't approximate
3. **Text analysis** (`extract_keywords`): Algorithmic processing better done deterministically than by LLM

### How Tool Calling Works (OpenAI Function Calling)

1. Tools are defined as JSON schemas following the OpenAI function calling specification
2. When calling `chat.completions.create()`, the `tools` parameter includes all three definitions
3. If the LLM decides to use a tool, it returns a response with `tool_calls` instead of `content`
4. We execute each tool call against the resume data
5. Results are appended as `role: "tool"` messages
6. We call the API again — the LLM now has the tool results and can formulate its answer
7. This loop repeats up to 3 times (the MAX_TOOL_ITERATIONS guard)

### Tool Call Loop Safety

The loop is capped at 3 iterations. Without this cap, a misbehaving LLM could call tools indefinitely. After 3 iterations, we force a final answer by making one more API call without the `tools` parameter and explicitly asking for the structured format.

---

## 5. Structured Output Enforcement

### The Schema

```typescript
{
  answer: string,        // The actual response text
  confidence: number,    // 0.0 to 1.0
  source: "resume" | "inference",
  missing_data: string[] // What was NOT found in the resume
}
```

### Two-Layer Enforcement

**Layer 1 — System Prompt Instructions**
The system prompt includes the exact JSON format and tells the LLM to always respond in that format. Llama 3.3 70B follows JSON formatting instructions reliably (>99% of the time).

**Layer 2 — Zod Runtime Validation**
After receiving the LLM's response, we:

1. Try to parse as JSON
2. Handle markdown code blocks (LLMs sometimes wrap JSON in ` ```json `)
3. Validate against `StructuredOutputSchema` (checks types, ranges, enums)
4. If validation fails, construct a fallback response with the raw text and `confidence: 0.5`

### Why Not Use OpenAI's `response_format`?

OpenAI's structured output (`response_format: { type: "json_schema" }`) has a limitation: it doesn't work reliably when combined with `tools` in the same request, especially through OpenRouter. Since we need both tool calling and structured output, we enforce structure via the system prompt + Zod validation. This is actually more robust because it works with any LLM provider.

### Confidence Score Calibration

The system prompt defines what confidence levels mean:

- **1.0**: Directly stated in the resume (e.g., "Skills: Python, React")
- **0.7–0.9**: Reasonable inference (e.g., inferring leadership from "Led a team of 5")
- **0.5–0.6**: Weak inference (e.g., assuming specific technologies from a broad domain)
- **Below 0.5**: Insufficient data — the LLM should say "Not mentioned"

This calibration is enforced via the system prompt, not code. The LLM assigns the score, and we trust it within the validated range [0, 1].

---

## 6. Guardrails and Reliability

### Anti-Hallucination Strategy

The system uses three complementary strategies:

1. **Data grounding**: The resume data is included in every system prompt. The LLM is instructed to only cite information from this data.

2. **Explicit "I don't know"**: The system prompt says: "If information is not in the resume, explicitly say 'Not mentioned in resume' and list the missing items in missing_data." This reframes uncertainty as a feature, not a failure.

3. **Source attribution**: The `source` field forces the LLM to classify each answer as either "resume" (directly from data) or "inference" (derived reasoning). The user can see this and calibrate trust accordingly.

### What Happens When Data Is Missing?

Example: User asks "What is the candidate's salary expectation?"

Expected response:

```json
{
  "answer": "Not mentioned in resume. The candidate's resume does not include salary expectations or compensation requirements.",
  "confidence": 0.0,
  "source": "resume",
  "missing_data": ["salary expectation", "compensation requirements"]
}
```

The frontend renders this with a red confidence bar and a "Not in resume" indicator — making it visually clear that this is missing data, not fabricated information.

### Error Handling

Every failure path produces a valid `StructuredOutput`:

- LLM returns non-JSON → fallback with raw text, `confidence: 0.5`
- Zod validation fails → fallback with raw text and `missing_data: ["Response format validation failed"]`
- Tool execution fails → tool returns `{ error: "Unknown tool" }` and the LLM incorporates the error
- API timeout → HTTP 500 with a user-friendly error message

The frontend never crashes from an unexpected backend response shape.

---

## 7. PDF Processing Pipeline

### Two-Stage Processing

**Stage 1: Text Extraction** (`pdf-parser.ts`)

- Uses `pdf-parse` v2 (based on `pdfjs-dist` under the hood)
- Takes a `Buffer` from the upload, creates a `PDFParse` instance with `data: new Uint8Array(buffer)`
- Calls `getText()` which returns a `TextResult` with `.text` (concatenated string of all pages)
- This is pure text extraction — no interpretation

**Stage 2: LLM Structuring** (`resume-structurer.ts`)

- Sends the raw text to Llama 3.3 70B (via Groq) with a system prompt asking for structured JSON extraction
- Uses `response_format: { type: "json_object" }` to enforce valid JSON
- Validates the response with `ResumeDataSchema` (Zod)
- Appends the `raw_text` field (for keyword extraction tool)

### Why Not Parse Resumes with Regex?

Resumes have no standard format. They use varied layouts, section headings, date formats, and structure. An LLM can understand "Led engineering team at Acme Corp (2019-2023)" as experience regardless of formatting. Regex can't.

### Limitations

- **Scanned PDFs**: `pdf-parse` cannot OCR image-based PDFs. If the extracted text is empty, the API returns an error asking the user to use a text-based PDF.
- **Complex layouts**: Multi-column PDFs may have interleaved text. The LLM handles this reasonably well during structuring.
- **Very long resumes**: Raw text is truncated to 8000 characters in the system prompt to avoid context window issues.

---

## 8. Session and Context Management

### In-Memory Store

Sessions are stored in a module-level `Map<string, Session>`:

```typescript
const sessions = new Map<string, Session>();
```

Each session contains:

- `id`: UUID v4
- `resume`: Structured resume data
- `messages`: Full conversation history
- `created_at`: Timestamp

### Why In-Memory on the Server?

For a demo/assignment, in-memory is the right choice for the server side:

- Zero dependencies (no Redis, no DB)
- Zero configuration
- Fast (Map access is O(1))
- Simple code (3 functions: get, create, update)

The trade-off: server sessions are lost on restart. But the client-side IndexedDB store preserves resume data and messages, and the `/api/restore` endpoint re-creates the server session on demand. For production, you'd use Redis (for session data) and PostgreSQL (for persistent storage).

### Client-Side Persistence (IndexedDB)

Sessions are also persisted client-side using IndexedDB via `chat-store.ts`:

- **Up to 3 sessions** stored (oldest evicted when a 4th is created)
- Each session stores: resume data (without raw_text), all messages, creation timestamp
- Sessions survive page refresh and browser restart
- When loading a past session, the frontend calls `/api/restore` to rebuild the server-side in-memory session from the stored data

### Session Restore Flow

When a user clicks a past session in the sidebar:

1. Client loads resume + messages from IndexedDB
2. Sets local state (sessionId, resume, messages)
3. POSTs to `/api/restore` with sessionId, resume, and messages
4. Server re-creates the in-memory session with the provided data
5. Chat is fully interactive — the user can continue asking questions

### How Context Is Built Per Request

Every chat request rebuilds the full message array:

1. **System prompt** with the resume data embedded
2. **Conversation history** from `session.messages` — user messages as `role: "user"`, assistant messages as `role: "assistant"` with their structured output stringified
3. **New user message**

This approach means the LLM has full context for every request — it can reference earlier answers, follow up on topics, and maintain coherent conversation.

### Context Window Management

The resume `raw_text` is truncated to 8000 characters in the system prompt. The structured resume fields (skills, experience, education) are always included in full. For most resumes (1-3 pages), the raw text fits well under 8000 characters.

Conversation history grows unbounded within a session. For a production system, you'd implement sliding window or summarization when history exceeds a threshold.

---

## 9. Frontend Architecture

### Component Hierarchy

```
page.tsx (state management)
├── ResumeUpload (file selection + upload)       [pre-session]
├── Sidebar (collapsible session history)        [overlays left panel]
├── ResumePreview (parsed data display)          [left panel]
└── ChatInterface (message list + input)         [right panel]
    ├── ChatMessage × N
    │   └── StructuredResponse (metadata display)
    └── Starter question chips (empty state)
```

### State Management

All state lives in `page.tsx` using React hooks:

- `sessionId: string | null` — null until upload
- `resume: ResumeData | null` — null until upload
- `messages: Message[]` — grows with each exchange
- `sidebarOpen: boolean` — toggles sidebar vs resume panel
- `pastSessions: ChatSession[]` — loaded from IndexedDB on mount

No state management library (Redux, Zustand). The state is simple and local. Five hooks in one component is clearer than a store for this scale.

### UI State Machine

```
State 1: No session
    → Show centered upload UI (ResumeUpload)
    → Hamburger button opens sidebar if past sessions exist
    → On successful upload → transition to State 2

State 2: Session active, sidebar closed
    → Left panel: ResumePreview (with hamburger + "New resume" buttons)
    → Right panel: ChatInterface
    → Hamburger opens sidebar → State 3
    → "New resume" → State 1

State 3: Session active, sidebar open
    → Left panel: Sidebar (replaces ResumePreview)
    → Right panel: ChatInterface (unchanged)
    → Click session → loads it, closes sidebar → State 2
    → "+ New Chat" → State 1
    → Close button → State 2
```

### Viewport-Locked Layout

The entire app is locked to viewport height with no page-level scrolling:

- `<html>` and `<body>` have `h-full overflow-hidden`
- Left panel (`aside`) has `h-full overflow-hidden` with inner `overflow-y-auto`
- Right panel (`main`) uses `flex-1 min-h-0 overflow-hidden`
- Both panels scroll independently within their bounds

### Instant User Messages

User messages appear immediately on screen when sent, without waiting for the API response. This is achieved by splitting the message handling into two callbacks:

- `onUserMessage`: called immediately on send, adds the user message to state
- `onAssistantMessage`: called when the API responds, adds the assistant message and persists to IndexedDB

### Dark Mode

Dark mode is implemented with Tailwind's class-based strategy:

- `@custom-variant dark (&:where(.dark, .dark *))` in `globals.css`
- `ThemeToggle` component in the header: sun/moon icon toggle
- Persistence: `localStorage.getItem("theme")` > `window.matchMedia("(prefers-color-scheme: dark)")` > light default
- CSS variables swap: `--color-background: #0a0a0a; --color-foreground: #fafafa;` in dark mode
- Every component uses `dark:` variants for backgrounds, text, borders, and badge colors

### Multi-Format Input

The upload flow supports three input methods:

- **PDF drag-and-drop**: Traditional file upload, processed by `pdf-parse`
- **Text file upload**: `.txt` files, read directly via `file.text()`
- **Paste input**: Expandable textarea, text is wrapped in `Blob` → `File` → `FormData` and sent to the same `/api/upload` endpoint

All three paths converge at the upload API route, which branches on file type for text extraction and then runs the same LLM structuring pipeline.

### Design Philosophy

The UI follows these principles:

- **Minimalistic**: Neutral color palette (grays, whites), no bright colors except for metadata indicators
- **Dark mode**: Full light/dark support with system preference detection and manual toggle
- **Information hierarchy**: The answer is primary (large text), metadata is secondary (small badges and bars)
- **Responsive**: Stacks vertically on mobile, side-by-side on desktop
- **Satoshi font**: Modern, clean typeface used throughout for consistency
- **Smooth animations**: CSS keyframe animations (fade-in, slide-in, stagger) on all transitions — no hard cuts

### StructuredResponse Component

This component is the key differentiator. For every assistant message, it shows:

- **Confidence bar**: Green (≥70%), amber (50-70%), red (<50%) — color-coded visual
- **Source badge**: "From resume" (blue) or "Inference" (amber)
- **Missing data**: Listed in subtle gray text with a warning icon

This makes the system's reliability transparent to the user.

---

## 10. LLM Integration via Groq (Llama 3.3 70B)

### Why Groq?

Groq provides:

- **Generous free tier**: 30 requests/minute, 1000 requests/day — 2x the RPM of Gemini's free tier
- **OpenAI-compatible endpoint**: `https://api.groq.com/openai/v1`
- **No credit card required**: Free API key from [console.groq.com](https://console.groq.com)
- **Full function calling support**: Llama 3.3 70B supports OpenAI-style tool/function calling with parallel tool calls
- **Ultra-fast inference**: Groq's LPU hardware delivers responses in under a second

### Provider Evolution

We initially used **Google Gemini 2.5 Flash** via its OpenAI-compatible endpoint. While the model quality was good, the free tier (15 RPM) caused frequent 429 rate limit errors even with retry logic. We switched to Groq which provides 30 RPM and more reliable availability. The switch required changing only three values: `baseURL`, `apiKey`, and `MODEL` — demonstrating the provider-agnostic architecture.

### How It Works

The entire integration uses the OpenAI SDK with a `baseURL` override:

```typescript
import OpenAI from "openai";

export const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

export const MODEL = "llama-3.3-70b-versatile";
```

This means the same code works with direct OpenAI, Azure OpenAI, Google Gemini, Groq, or any OpenAI-compatible API — a one-line `baseURL` change is all it takes to switch providers.

### Retry with Exponential Backoff

The `chatWithRetry` function wraps all LLM calls with:

- Max 3 retry attempts
- Exponential backoff: 10s → 20s → 40s (capped at 60s)
- Extracts the `Retry-After` header from 429 responses when available
- Only retries on 429 (rate limit) status codes
- Non-retryable errors (400, 401, 403) throw immediately
- API routes propagate 429 to the frontend with user-friendly messages
- The frontend auto-retries uploads on rate limit (up to 3 attempts with 20s/40s waits)

### Model Choice: Llama 3.3 70B

Llama 3.3 70B Versatile on Groq is chosen for:

- **Free tier**: No cost for development and demos
- **Reliable function calling**: Full OpenAI-style tool calling with parallel tool support
- **JSON adherence**: Consistently produces valid JSON when instructed via system prompt
- **Speed**: Groq's LPU hardware delivers sub-second inference
- **Quality**: 70B parameter model provides strong reasoning for resume analysis

### JSON Extraction from LLM Responses

LLMs sometimes wrap JSON in markdown code blocks (` ```json ... ``` `). Both `agent.ts` and `resume-structurer.ts` handle this:

````typescript
let jsonStr = content.trim();
const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
if (jsonMatch) {
  jsonStr = jsonMatch[1].trim();
}
const parsed = JSON.parse(jsonStr);
````

---

## 11. Client-Side Persistence (IndexedDB)

### Why IndexedDB?

The system needs to persist chat sessions across page refreshes. The options were:

- **localStorage**: Limited to ~5MB, synchronous, string-only — poor fit for structured session data with many messages
- **IndexedDB**: Async, structured data, large storage limits (~50MB+), transaction-based — ideal for this use case
- **Server-side DB**: Adds complexity and infrastructure for what's fundamentally client-side state

### Implementation (`chat-store.ts`)

Three functions wrapping the IndexedDB API:

- `saveChatSession(session)`: Upsert a session. If there are already 3 sessions and this is a new one, evict the oldest.
- `getChatSessions()`: Return all sessions sorted by recency (newest first).
- `deleteChatSession(id)`: Remove a session by ID.

### Session Eviction

`MAX_SESSIONS = 3` — this limits to 3 resume sessions (not 3 messages). Each session stores ALL its messages. When a 4th resume is uploaded, the oldest session is automatically deleted.

### What's Stored

```typescript
interface ChatSession {
  id: string; // UUID matching server session
  resumeName: string; // For sidebar display
  resume: Omit<ResumeData, "raw_text">; // Structured data, no raw text
  messages: Message[]; // Full conversation history
  created_at: number; // Timestamp for sorting
}
```

### Sidebar Component

The collapsible sidebar (`Sidebar.tsx`) provides:

- List of past sessions with resume name, first message preview, and relative timestamp
- Active session highlighted
- "+ New Chat" button to reset and upload a new resume
- Close button to return to the resume panel
- Replaces the ResumePreview panel when open (same aside slot, no layout shift)

---

## 12. Design Decisions and Trade-offs

### Decision 1: No Streaming

**Chose**: Non-streaming API calls with a "thinking" indicator
**Alternative**: Server-Sent Events (SSE) streaming

**Why**: The structured output requirement (`{ answer, confidence, source, missing_data }`) needs the complete JSON to validate. Streaming would mean:

- Showing partial JSON (bad UX)
- Or buffering the entire response and then parsing (same latency, more complexity)
- Tool calls add another complication — you'd need to stream tool results then final answer

**Trade-off**: Users wait 2-5 seconds for each response. Acceptable for a professional tool where accuracy matters more than speed. The "thinking" animation (bouncing dots) signals the system is working.

### Decision 2: System Prompt for Structured Output (vs. `response_format`)

**Chose**: Embed JSON schema in system prompt + Zod validation
**Alternative**: OpenAI's `response_format: { type: "json_schema" }`

**Why**: Not all OpenAI-compatible endpoints fully support `response_format` with `json_schema` when combined with tool calling. Putting instructions in the system prompt works universally — any provider, any model. Zod validation is the safety net. LLMs sometimes wrap JSON in markdown code blocks, which the `parseStructuredOutput` function handles.

**Trade-off**: Very rarely (~1% of requests), the LLM may not return valid JSON. The fallback handler catches this and constructs a valid response from the raw text.

### Decision 3: Hybrid Persistence (In-Memory + IndexedDB)

**Chose**: Server-side `Map<string, Session>` + client-side IndexedDB
**Alternative**: Redis, PostgreSQL, or server-side-only storage

**Why**: The server-side Map gives zero-config, zero-dependency session management. IndexedDB adds persistence across page refreshes and browser restarts without requiring a database. The `/api/restore` endpoint bridges the two — when a user loads a past session, the client sends the stored data to re-create the server session.

**Trade-off**: Server sessions are still lost on restart, but the client immediately restores them on demand. Not horizontally scalable (each server instance has its own map). Both are non-issues for a demo but would need to be addressed in production.

### Decision 4: PDF Parsing with LLM (Two-Stage)

**Chose**: `pdf-parse` for text extraction + Llama 3.3 70B (via Groq) for structuring
**Alternative**: Pure regex/NLP parsing, or dedicated resume parsing APIs (Affinda, Sovren)

**Why**: Resumes have no standard format. LLMs excel at understanding unstructured text regardless of layout. A regex parser would be brittle. A dedicated API would add a dependency and cost.

**Trade-off**: The initial upload takes 3-8 seconds (PDF extraction + LLM call). This is a one-time cost per resume. The structured data is then reused for all subsequent chat messages.

### Decision 5: Tool Definitions as Code (Not Database)

**Chose**: Tool definitions hardcoded in `tools.ts`
**Alternative**: Dynamic tool registry, plugin system

**Why**: Three tools is a fixed, known set. A dynamic registry adds complexity for zero benefit. If you need a new tool, add it to `tools.ts` and `executeTool()`.

**Trade-off**: Adding new tools requires a code change and redeployment. For a dynamic agent system with user-defined tools, you'd want a registry. Not needed here.

### Decision 6: Dark Mode with Class-Based Toggling

**Chose**: Tailwind `dark:` variant with `@custom-variant dark (&:where(.dark, .dark *))`, toggled via a class on `<html>`, persisted to `localStorage`, with system preference detection as default.
**Alternative**: CSS `prefers-color-scheme` media query only, or no dark mode.

**Why**: Users increasingly expect dark mode. Class-based toggling gives us explicit control (user can override system preference). `localStorage` persistence means the choice survives across sessions. System preference detection (`window.matchMedia("(prefers-color-scheme: dark)")`) provides a sensible default on first visit. The `ThemeToggle` component handles all three: stored preference > system preference > light default.

**Trade-off**: Every styled element needs both light and `dark:` classes, which roughly doubles the Tailwind class count on each element. Worth it for the UX.

### Decision 7: Multi-Format Resume Input (PDF + Text + Paste)

**Chose**: Accept PDF uploads, .txt file uploads, and raw pasted text — all funneled to the same `/api/upload` endpoint.
**Alternative**: PDF-only upload.

**Why**: Not all resumes are PDFs. Recruiters often copy-paste resume text from ATS systems or emails. Supporting paste input means the user doesn't need to save text to a file first. The implementation is simple — pasted text is wrapped in a `Blob` → `File` → `FormData` on the client, reusing the same upload API.

**Trade-off**: None significant. The upload route branches on file type (`application/pdf` vs `text/plain`) and uses the appropriate parser. Minimal added complexity for a much better UX.

---

## 13. What I Would Do Differently at Scale

### Database Layer

- **PostgreSQL** for persistent resume and session storage
- **Redis** for session cache (fast access, TTL-based expiration)
- **Prisma** as ORM for type-safe database access

### Authentication

- **NextAuth.js** for user authentication
- Session-based auth tied to user accounts
- Resume history per user

### Resume Processing

- **Queue-based processing**: Upload goes to a job queue (BullMQ), processed asynchronously
- **OCR support**: For scanned PDFs, use Tesseract.js or an OCR API
- **Multi-format**: Support DOCX, RTF, plain text via appropriate parsers

### LLM Layer

- **Streaming with structured output**: Buffer the stream, validate on completion, show "Analyzing..." with progress
- **Rate limiting**: Per-user rate limits to prevent abuse
- **Model fallback**: If Groq is rate-limited, fall back to an alternative provider (e.g., SambaNova, Cerebras)
- **Prompt versioning**: Track system prompt versions for A/B testing

### Observability

- **Structured logging**: Log every LLM call with latency, token usage, tool calls made
- **LangSmith or Langfuse**: For LLM observability (trace tool call chains, inspect prompts)
- **Error tracking**: Sentry for frontend/backend errors

### Testing

- **Unit tests**: Jest for tool functions (deterministic, easy to test)
- **Integration tests**: Test API routes with mock LLM responses
- **E2E tests**: Playwright for upload → chat flow

### Vector Search

- **Embedding-based retrieval**: For very long resumes, embed sections and retrieve relevant chunks
- **RAG pattern**: Instead of dumping the entire resume in the system prompt, retrieve only relevant sections per question

---

## 14. Common Interview Questions

### Q: Why is this "agentic" and not just a chatbot?

A: Five reasons: (1) **Role definition** — it has a strict persona (hiring assistant) that constrains behavior. (2) **Tool autonomy** — the LLM decides when to call tools vs. answer directly. (3) **Guardrails** — it actively refuses to hallucinate and reports missing data. (4) **Structured output** — every response follows a contract, not free-form text. (5) **Context management** — it maintains resume data + conversation history across interactions.

A chatbot takes input and returns output. An agent has a defined role, makes decisions about how to accomplish tasks, uses tools, and maintains state.

### Q: How do you prevent the LLM from hallucinating?

A: Three layers: (1) **Data grounding** — the resume data is in every system prompt, and the LLM is instructed to only cite from it. (2) **Explicit "I don't know"** — the prompt says to use "Not mentioned in resume" and populate `missing_data[]`. (3) **Source attribution** — every response must declare whether it came from "resume" (direct data) or "inference" (reasoning), making the provenance visible.

### Q: Why not stream the responses?

A: The structured output format (`{ answer, confidence, source, missing_data }`) requires the complete JSON to validate. Streaming would mean either showing partial JSON (bad UX) or buffering the entire response (same latency, more complexity). For a tool where accuracy matters more than speed, a "thinking" indicator with a 2-5 second wait is the right UX choice.

### Q: How does the tool calling loop work?

A: We send the messages + tool definitions to Llama 3.3 70B via Groq. If it returns `tool_calls`, we execute each tool against the resume data, append results as `role: "tool"` messages, and call the API again. This repeats up to 3 times. If the LLM still hasn't given a final answer after 3 tool call rounds, we make one final call without tools and ask for the structured format explicitly. This prevents infinite loops.

### Q: What happens if the LLM returns invalid JSON?

A: We have a `parseStructuredOutput()` function with multiple fallbacks: (1) Try to parse as JSON directly. (2) Check for markdown code blocks (` ```json ... ``` `) and extract the JSON. (3) Validate with Zod. If all fail, construct a fallback response with the raw text as the answer, `confidence: 0.5`, `source: "inference"`, and `missing_data: ["Response format validation failed"]`. The frontend always receives a valid `StructuredOutput`.

### Q: Why in-memory sessions on the server instead of a database?

A: For a demo, in-memory is the right engineering call for the server side. Zero dependencies, zero config, zero latency. But I didn't stop there — client-side IndexedDB provides persistence across page refreshes. When a user loads a past session, the `/api/restore` endpoint re-creates the server session from the client-stored data. This gives us the simplicity of in-memory with the durability of a database. For production, I'd use Redis for session cache and PostgreSQL for persistent storage.

### Q: How does the session restore work?

A: When a user clicks a past session in the sidebar: (1) The client loads the session from IndexedDB — resume data and full message history. (2) The client sets local state to display the conversation immediately. (3) A POST to `/api/restore` sends the sessionId, resume data, and messages to the server. (4) The server re-creates the in-memory session with the provided data, including rebuilding the conversation history. (5) The chat is now fully interactive — the user can continue asking questions as if they never left.

### Q: Why IndexedDB over localStorage?

A: Three reasons: (1) **Size** — localStorage caps at ~5MB, IndexedDB can store 50MB+. With full message histories per session, we could easily exceed localStorage limits. (2) **Async API** — localStorage is synchronous and blocks the main thread; IndexedDB is async and non-blocking. (3) **Structured data** — localStorage is string-only (requires JSON.stringify/parse); IndexedDB stores structured objects directly with indexed queries.

### Q: How would you scale this to handle 1000 concurrent users?

A: Four changes: (1) Move sessions from in-memory to Redis. (2) Deploy behind a load balancer — sessions are stateless per request (fetched from Redis). (3) Add rate limiting per user. (4) Use a job queue for PDF processing (it's CPU-intensive and should not block the API server). The agent logic itself is stateless — it rebuilds context from the session store on each request.

### Q: Why Zod for validation?

A: Zod provides runtime type checking for LLM outputs. TypeScript types only exist at compile time — they can't catch a malformed JSON response from an LLM at runtime. Zod gives us: type narrowing (`.parse()` throws or returns the correct type), range validation (`confidence` must be 0-1), enum validation (`source` must be "resume" or "inference"), and graceful error handling via `.safeParse()`.

### Q: How does the skill matching tool work?

A: It compares each required skill against the resume's skill list using case-insensitive substring matching. "react" matches "React.js" because `"react.js".includes("react")` is true. The bidirectional check (`rs.includes(skill) || skill.includes(rs)`) handles both directions — so "JavaScript" matches "JS" and vice versa. Returns matched skills, missing skills, and a percentage.

### Q: Why did you use the OpenAI SDK with Groq instead of a provider-specific SDK?

A: Groq (and many other providers like Google Gemini, SambaNova, Cerebras) offer OpenAI-compatible endpoints. The OpenAI SDK has better TypeScript types, better documentation, a larger ecosystem, and native support for function calling schemas. Using it with a `baseURL` override means we get the best developer experience while keeping the LLM layer completely provider-agnostic. We proved this when we switched from Gemini to Groq — only three values changed (`baseURL`, `apiKey`, `MODEL`), zero code changes. If we ever wanted to switch to direct OpenAI, Azure, or another provider, it's equally trivial.

### Q: What's the most complex part of this system?

A: `agent.ts` — the tool calling loop. It handles: building the context (system prompt + history), managing the tool call loop with a safety cap, dispatching to the correct tool implementation, injecting tool results back into the conversation, parsing and validating the final output, handling fallbacks on parse failure, and updating the session store. It's 120 lines of code but orchestrates the entire intelligence layer.

### Q: How do you handle conversation context?

A: Every chat request rebuilds the full message array from scratch: system prompt (with resume data embedded), then all previous messages from `session.messages`, then the new user message. The system prompt includes the structured resume data as JSON, so the LLM always has access to the candidate's information. The conversation history lets the LLM reference previous answers and maintain coherent multi-turn dialogue.

### Q: What trade-off did you struggle with most?

A: Streaming vs. structured output. Streaming gives a better perceived UX (users see text appearing), but the structured format requires complete JSON for validation. I chose reliability over responsiveness — in a hiring tool, showing incorrect confidence scores or missing data would be worse than a 3-second wait. If I had more time, I'd explore hybrid streaming: stream the `answer` field progressively and append the metadata fields when the stream completes.

### Q: Why Satoshi font?

A: Satoshi is a modern, geometric sans-serif from Indian Type Foundry (via fontshare.com). It's clean, highly readable, and professional without being generic like Inter or system fonts. Self-hosting the woff2 files means no CDN dependency and no flash of unstyled text (FOUT). It's a small detail, but it shows attention to design craft.

### Q: How would you add the optional WebRTC feature?

A: The WebRTC requirement is specifically for real-time audio — no STT/TTS, just raw audio streaming. I would: (1) Add a signaling server using WebSocket (Next.js API route with upgrade). (2) Use the browser's `RTCPeerConnection` API on the client. (3) Handle offer/answer/ICE candidate exchange via WebSocket. (4) Stream audio via `MediaStream` + `getUserMedia()`. (5) On the server, use `wrtc` (Node.js WebRTC implementation) to receive the audio stream. The key challenges are NAT traversal (STUN/TURN servers), connection lifecycle management (reconnection on network change), and low-latency audio transfer (opus codec, 20ms packets).

### Q: Walk me through what happens when a user asks "Does this candidate know React and Python?"

A: Step by step:

1. Frontend sends `POST /api/chat` with `{ sessionId, message: "Does this candidate know React and Python?" }`
2. The user message appears immediately on screen (via `onUserMessage` callback)
3. `agent.ts` loads the session, builds the message array with system prompt + history
4. Llama 3.3 70B (via Groq) receives the messages and tool definitions (via `chatWithRetry` with exponential backoff)
5. The LLM decides to call `match_skills(["React", "Python"])` — this is the agentic decision
6. `tools.ts` executes: compares ["React", "Python"] against the resume's skills list
7. Returns something like `{ matched: ["React"], missing: ["Python"], match_percentage: 50 }`
8. The tool result is appended as a `role: "tool"` message
9. Llama 3.3 70B is called again with the tool result
10. It generates: `{ answer: "The candidate has React listed as a skill but Python is not mentioned...", confidence: 0.9, source: "resume", missing_data: ["Python"] }`
11. Response may be wrapped in markdown code blocks — `parseStructuredOutput` strips them before JSON.parse
12. Zod validates the response, session is updated, response is returned
13. Frontend renders the answer via `onAssistantMessage`, saves to IndexedDB
14. UI shows: green 90% confidence bar, "From resume" badge, and "Not in resume: Python" indicator
