# Resume Assistant

An AI-powered resume analysis system built with Next.js. Upload a PDF or text resume (or paste text directly), get structured data extraction, and chat with an agentic AI hiring assistant that uses tools, guardrails, and structured outputs.

## Setup

### Prerequisites

- Node.js 18+
- A [Groq](https://console.groq.com/) API key (free tier — Llama 3.3 70B)

### Installation

```bash
git clone [<repo-url>](https://github.com/tejas261/intelligent-resume-assistant)
cd intelligent-resume-assistant
npm install
```

### Environment

Create `.env.local` in the project root:

```
GROQ_API_KEY=your-key-here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/
├── app/
│   ├── layout.tsx              # Root layout, Satoshi font
│   ├── globals.css             # Tailwind v4, dark mode, animation keyframes
│   ├── page.tsx                # Main page: upload → chat flow, state management
│   └── api/
│       ├── upload/route.ts     # PDF/TXT upload + parsing
│       ├── chat/route.ts       # Chat with structured output
│       └── restore/route.ts    # Restore past session to backend
├── components/
│   ├── ResumeUpload.tsx        # Drag-drop upload, text file, paste input
│   ├── ResumePreview.tsx       # Extracted resume summary (left panel)
│   ├── ChatInterface.tsx       # Message list + input + starter questions
│   ├── ChatMessage.tsx         # Single message bubble with slide-in animation
│   ├── StructuredResponse.tsx  # Confidence bar, source badge, missing data
│   ├── Sidebar.tsx             # Collapsible session history
│   └── ThemeToggle.tsx         # Dark mode toggle with localStorage persistence
└── lib/
    ├── openai.ts               # OpenAI SDK → Groq API (provider-agnostic)
    ├── session.ts              # In-memory session store
    ├── pdf-parser.ts           # PDF text extraction (pdf-parse v2)
    ├── resume-structurer.ts    # LLM-based resume structuring
    ├── agent.ts                # Agentic core: system prompt, tool loop, guardrails
    ├── tools.ts                # Tool definitions + implementations
    ├── schemas.ts              # Zod validation schemas
    └── chat-store.ts           # IndexedDB persistence (client-side)
```

### Data Flow

1. **Upload**: PDF/TXT/pasted text → `pdf-parse` extracts text (PDF) or `file.text()` (TXT) → Llama 3.3 70B structures into `ResumeData` → stored in-memory + IndexedDB
2. **Chat**: User message + session context → agent builds messages with system prompt + conversation history → LLM decides to use tools or answer directly → response validated against `StructuredOutput` schema → returned to client
3. **Persist**: Each session (resume + all messages) saved to IndexedDB, up to 3 most recent sessions retained

### Agentic Design

The system is not a simple chatbot — it implements several agentic patterns:

- **Tool Use**: Three tools (`search_resume_section`, `match_skills`, `extract_keywords`) that the LLM autonomously decides when to invoke via OpenAI function calling
- **Guardrails**: System prompt enforces a strict hiring assistant role. The LLM must say "Not mentioned in resume" for missing data and never fabricate information
- **Structured Output**: Every response conforms to `{ answer, confidence, source, missing_data }` validated by Zod
- **Context Management**: Full conversation history + extracted resume data replayed on every LLM call for multi-turn coherence
- **Tool Loop**: Up to 3 iterations of tool calls before forcing a final answer

### Client-Side Persistence

- **IndexedDB** stores last 3 resume sessions with full message history
- **Collapsible sidebar** for switching between past sessions
- **Session restore**: Loading a past session re-creates the backend in-memory session via `/api/restore`
- Past sessions are fully interactive (not read-only)

### UI Features

- **Dark mode**: Class-based toggling with system preference detection and `localStorage` persistence
- **Multi-format input**: PDF drag-drop, .txt file upload, or paste text directly
- **Smooth animations**: CSS keyframe animations (fade-in, slide-in, stagger) on all transitions
- **Instant messages**: User messages appear immediately, assistant response loads asynchronously
- **Viewport-locked layout**: Fixed height, independent scroll on resume panel and chat panel

### Design Decisions

| Decision | Rationale |
|---|---|
| **Groq API (Llama 3.3 70B)** | Free tier with 30 RPM; OpenAI-compatible via SDK `baseURL` override; switched from Gemini due to stricter rate limits |
| **Provider-agnostic LLM layer** | OpenAI SDK with `baseURL` override — swap providers by changing 3 values, zero code changes |
| **No streaming** | Structured JSON output requires complete response for validation |
| **In-memory sessions** | Simplest approach for a demo; no DB overhead. IndexedDB on client provides persistence |
| **System prompt for JSON** | Works across all providers; Zod validates at runtime as safety net |
| **Self-hosted Satoshi font** | No CDN dependency, no FOUT, fully offline-capable |
| **pdf-parse v2** | Zero native dependencies, works in Next.js route handlers |
| **Class-based dark mode** | Explicit control via toggle; `localStorage` persistence; system preference as default |

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **OpenAI SDK** → Groq API (Llama 3.3 70B Versatile)
- **pdf-parse v2** — PDF text extraction
- **Zod** — structured output validation
- **Tailwind CSS v4** — styling with dark mode
- **Satoshi** — typography (self-hosted woff2)
- **IndexedDB** — client-side session persistence
