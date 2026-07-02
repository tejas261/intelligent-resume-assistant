// Minimal type declarations for the parts of faiss-node we use.
declare module "faiss-node" {
  export interface SearchResult {
    /** Similarity scores, one per result, in descending order. */
    distances: number[];
    /** Insertion indices of the matched vectors (0-based). */
    labels: number[];
  }

  /**
   * Flat index using inner product. With L2-normalized vectors, inner
   * product equals cosine similarity (higher = more similar).
   */
  export class IndexFlatIP {
    constructor(dimension: number);
    /** Add vectors as a single flat array of length n * dimension. */
    add(vectors: number[]): void;
    /** Search with one query vector (length = dimension). */
    search(query: number[], k: number): SearchResult;
    ntotal(): number;
    getDimension(): number;
  }

  export class IndexFlatL2 {
    constructor(dimension: number);
    add(vectors: number[]): void;
    search(query: number[], k: number): SearchResult;
    ntotal(): number;
    getDimension(): number;
  }
}
