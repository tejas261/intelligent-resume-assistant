/**
 * Retrieval eval harness.
 *
 * Measures whether RAG retrieval returns the *right* passages, as a number,
 * instead of eyeballing answers. This is what lets you tune chunk size, the
 * embedding model, or the relevance threshold with evidence rather than vibes,
 * and catch regressions when you change one of them.
 *
 * Run:  npm run eval:rag
 *
 * How it works:
 *  - A self-contained sample resume is chunked, embedded, and indexed.
 *  - A hand-written golden set maps a question -> markers that MUST appear in
 *    at least one retrieved chunk (substring match is robust to chunk
 *    boundaries, unlike exact chunk equality).
 *  - One negative case checks the grounding guardrail: a question with no
 *    answer in the resume should retrieve nothing above the relevance
 *    threshold.
 *  - Output is a hit-rate, e.g. "Retrieval hit-rate: 7/8 (87.5%)".
 */
import { buildIndex, semanticSearch } from "./vector-store";
import { chunkText } from "./chunker";

// Mirrors RELEVANCE_THRESHOLD in tools.ts — below this a chunk is "not relevant".
const RELEVANCE_THRESHOLD = 0.25;
const TOP_K = 3;

const SAMPLE_RESUME = `
Tejas M — Software Engineer

Summary: Full-stack engineer focused on Node.js backends and AI-powered features.

Experience:
Software Engineer at Acme. Designed and built a Kafka-based notification
microservice that processed high-throughput event streams with at-least-once
delivery. Owned the service end to end and mentored two junior engineers.

Built an AI pull-request analyser using LangChain and GPT-4 with tool/function
calling. It reviews diffs and posts structured feedback to Slack, cutting manual
review effort by around 60 percent.

Skills: Node.js, Express, Next.js, React, TypeScript, MongoDB, MySQL,
PostgreSQL, Docker, AWS, Git.

Education: Bachelor of Engineering in Computer Science, 2024.
`;

interface GoldenCase {
  question: string;
  /** At least one of these (case-insensitive) must appear in a top-k chunk. */
  expectIncludes?: string[];
  /** If true, retrieval should return NOTHING above the threshold. */
  expectNoMatch?: boolean;
}

const GOLDEN: GoldenCase[] = [
  { question: "Does the candidate have message queue experience?", expectIncludes: ["kafka"] },
  { question: "What AI or LLM projects have they built?", expectIncludes: ["langchain", "gpt-4", "analyser"] },
  { question: "Which databases does the candidate know?", expectIncludes: ["mongodb", "mysql", "postgresql"] },
  { question: "Do they have any leadership or mentoring experience?", expectIncludes: ["mentor"] },
  { question: "What frontend frameworks can they use?", expectIncludes: ["react", "next.js"] },
  { question: "What is their highest level of education?", expectIncludes: ["bachelor", "computer science"] },
  // Negative case — tests the grounding guardrail, not retrieval recall.
  { question: "How many years did they play professional football?", expectNoMatch: true },
];

async function main() {
  const sessionId = "eval";
  // Smaller chunks than the app default: this short sample resume would
  // otherwise collapse into one chunk, diluting similarity. (Demonstrates
  // exactly why chunk size is a tunable that the eval lets you compare.)
  const chunks = chunkText(SAMPLE_RESUME, { size: 45, overlap: 10 });
  await buildIndex(sessionId, chunks);
  console.log(`Indexed ${chunks.length} chunks. Running ${GOLDEN.length} cases (top_k=${TOP_K}).\n`);

  let passed = 0;

  for (const c of GOLDEN) {
    const results = await semanticSearch(sessionId, c.question, TOP_K);
    const topScore = results[0]?.score ?? 0;
    const relevant = results.filter((r) => r.score >= RELEVANCE_THRESHOLD);

    let pass: boolean;
    let detail: string;

    if (c.expectNoMatch) {
      pass = relevant.length === 0;
      detail = pass
        ? `correctly found nothing relevant (top score ${topScore.toFixed(3)})`
        : `LEAK: returned ${relevant.length} chunk(s) above threshold (top ${topScore.toFixed(3)})`;
    } else {
      const haystack = relevant.map((r) => r.text.toLowerCase()).join(" \n ");
      const hit = (c.expectIncludes ?? []).find((m) => haystack.includes(m.toLowerCase()));
      pass = Boolean(hit);
      detail = pass
        ? `found "${hit}" (top score ${topScore.toFixed(3)})`
        : `MISS: none of [${(c.expectIncludes ?? []).join(", ")}] in top-${TOP_K} (top ${topScore.toFixed(3)})`;
    }

    if (pass) passed++;
    console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  ${c.question}\n        ${detail}\n`);
  }

  const pct = ((passed / GOLDEN.length) * 100).toFixed(1);
  console.log(`Retrieval hit-rate: ${passed}/${GOLDEN.length} (${pct}%)`);
  if (passed < GOLDEN.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
