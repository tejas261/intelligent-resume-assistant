import { IndexFlatIP } from "faiss-node";
import { embed, embedBatch } from "./embeddings";

export interface RetrievedChunk {
  text: string;
  /** Cosine similarity in [-1, 1]; higher = more relevant. */
  score: number;
}

interface SessionIndex {
  index: IndexFlatIP;
  chunks: string[];
  dim: number;
}

// One FAISS index per session, held in memory (mirrors the in-memory
// session store). In production this would be a persistent, multi-tenant
// vector DB; per-session in-memory keeps the demo simple and correct.
const store = new Map<string, SessionIndex>();

/**
 * Embed the given chunks and build a FAISS inner-product index for a session.
 * Replaces any existing index for that session.
 */
export async function buildIndex(
  sessionId: string,
  chunks: string[],
): Promise<number> {
  if (chunks.length === 0) {
    store.delete(sessionId);
    return 0;
  }

  const vectors = await embedBatch(chunks);
  const dim = vectors[0].length;

  const index = new IndexFlatIP(dim);
  // faiss-node expects all vectors as one flat array of length n * dim.
  index.add(vectors.flat());

  store.set(sessionId, { index, chunks, dim });
  return chunks.length;
}

/**
 * Embed the query and return the top-k most similar chunks for a session.
 * Returns [] if the session has no index.
 */
export async function semanticSearch(
  sessionId: string,
  query: string,
  k = 4,
): Promise<RetrievedChunk[]> {
  const session = store.get(sessionId);
  if (!session) return [];

  const queryVector = await embed(query);
  const topK = Math.min(k, session.chunks.length);
  const { distances, labels } = session.index.search(queryVector, topK);

  return labels.map((label, i) => ({
    text: session.chunks[label],
    score: distances[i],
  }));
}

export function hasIndex(sessionId: string): boolean {
  return store.has(sessionId);
}

export function clearIndex(sessionId: string): void {
  store.delete(sessionId);
}
