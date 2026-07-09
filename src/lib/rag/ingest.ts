import type { ResumeData } from "@/types";
import { chunkText, resumeToText } from "./chunker";
import { buildIndex } from "./vector-store";

/**
 * Ingest a resume into the RAG index for a session:
 * resume text -> chunks -> embeddings -> Chroma index.
 *
 * Prefers raw_text (the full original document). Falls back to a flattened
 * view of the structured fields when raw_text is missing (e.g. on restore,
 * where the client did not persist raw_text).
 *
 * @returns number of chunks indexed
 */
export async function ingestResume(
  sessionId: string,
  resume: ResumeData,
): Promise<number> {
  const source =
    resume.raw_text && resume.raw_text.trim().length > 0
      ? resume.raw_text
      : resumeToText(resume);

  const chunks = chunkText(source);
  const count = await buildIndex(sessionId, chunks);
  console.log(`[RAG] Ingested ${count} chunks for session ${sessionId}`);
  return count;
}
