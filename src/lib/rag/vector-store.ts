import { CloudClient, type Collection } from "chromadb";
import { embed, embedBatch } from "./embeddings";

export interface RetrievedChunk {
  text: string;
  /** Cosine similarity in [-1, 1]; higher = more relevant. */
  score: number;
}

// Single multi-tenant collection. Each chunk carries a `sessionId` in its
// metadata, and every read/write is scoped by a `where: { sessionId }` filter.
// This is the standard hosted-vector-DB pattern: one durable index that
// survives serverless cold starts (unlike the old in-memory FAISS index),
// rather than one index object per session.
const COLLECTION_NAME = "resume_chunks";

// Cosine space so query distances are cosine distance (1 - similarity); we
// convert back to similarity below to preserve the [-1, 1] "higher = better"
// contract the rest of the app (tools.ts, eval.ts) relies on.
let collectionPromise: Promise<Collection> | null = null;

function getCollection(): Promise<Collection> {
  if (!collectionPromise) {
    const client = new CloudClient({
      apiKey: process.env.CHROMA_API_KEY,
      tenant: process.env.CHROMA_TENANT,
      database: process.env.CHROMA_DATABASE,
    });
    // Bring-your-own embeddings: we pass precomputed vectors on every add and
    // query, so the collection needs no server-side embedding function.
    collectionPromise = client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: null,
      configuration: { hnsw: { space: "cosine" } },
    });
  }
  return collectionPromise;
}

// Stable, collection-unique id for a session's chunk. Rebuilds delete by
// sessionId first, so ids never collide across sessions or across rebuilds.
const chunkId = (sessionId: string, i: number) => `${sessionId}#${i}`;

/**
 * Embed the given chunks and (re)build this session's slice of the shared
 * Chroma index. Replaces any existing chunks for that session.
 *
 * @returns number of chunks indexed
 */
export async function buildIndex(
  sessionId: string,
  chunks: string[],
): Promise<number> {
  const collection = await getCollection();

  // Replace semantics: clear the session's old chunks first so a shorter new
  // resume can't leave stale chunks behind.
  await collection.delete({ where: { sessionId } });

  if (chunks.length === 0) return 0;

  const embeddings = await embedBatch(chunks);
  await collection.add({
    ids: chunks.map((_, i) => chunkId(sessionId, i)),
    embeddings,
    documents: chunks,
    metadatas: chunks.map(() => ({ sessionId })),
  });

  return chunks.length;
}

/**
 * Embed the query and return the top-k most similar chunks for a session.
 * Returns [] if the session has no chunks indexed.
 */
export async function semanticSearch(
  sessionId: string,
  query: string,
  k = 4,
): Promise<RetrievedChunk[]> {
  const collection = await getCollection();
  const queryEmbedding = await embed(query);

  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: k,
    where: { sessionId },
    include: ["documents", "distances"],
  });

  const documents = result.documents[0] ?? [];
  const distances = result.distances[0] ?? [];

  const chunks: RetrievedChunk[] = [];
  for (let i = 0; i < documents.length; i++) {
    const text = documents[i];
    const distance = distances[i];
    if (text == null || distance == null) continue;
    // cosine distance -> cosine similarity
    chunks.push({ text, score: 1 - distance });
  }
  return chunks;
}

export async function hasIndex(sessionId: string): Promise<boolean> {
  const collection = await getCollection();
  const result = await collection.get({ where: { sessionId }, limit: 1 });
  return result.ids.length > 0;
}

export async function clearIndex(sessionId: string): Promise<void> {
  const collection = await getCollection();
  await collection.delete({ where: { sessionId } });
}
