import type { ResumeData } from "@/types";

export interface ChunkOptions {
  /** Target chunk size in words. */
  size?: number;
  /** Number of words shared between consecutive chunks. */
  overlap?: number;
}

/**
 * Split text into overlapping fixed-size chunks (word-based sliding window).
 *
 * Why overlap: a skill or sentence that lands on a chunk boundary would
 * otherwise be split across two chunks and retrieved poorly. The overlap
 * keeps boundary context intact in at least one chunk.
 *
 * Tradeoff: larger `size` = more context per chunk but noisier/diluted
 * retrieval; smaller `size` = sharper retrieval but more chunks and risk
 * of losing surrounding context.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const { size = 120, overlap = 20 } = opts;
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 0) return [];
  if (words.length <= size) return [words.join(" ")];

  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + size, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
  }

  return chunks;
}

/**
 * Build a flat text representation of a structured resume.
 *
 * Used as the ingestion source when `raw_text` is unavailable — e.g. the
 * client persists sessions to IndexedDB without raw_text, so on restore we
 * rebuild the searchable text from the structured fields instead.
 */
export function resumeToText(resume: ResumeData): string {
  const parts: string[] = [`Name: ${resume.name}`];

  if (resume.summary) parts.push(`Summary: ${resume.summary}`);
  if (resume.skills.length) parts.push(`Skills: ${resume.skills.join(", ")}`);

  for (const e of resume.experience) {
    parts.push(
      `Experience: ${e.title} at ${e.company} (${e.duration}). ${e.description}`,
    );
  }

  for (const e of resume.education) {
    parts.push(`Education: ${e.degree}, ${e.institution} (${e.year})`);
  }

  return parts.join("\n");
}
