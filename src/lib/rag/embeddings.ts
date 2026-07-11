import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@xenova/transformers";

// On Vercel the default cache dir (inside node_modules) is read-only, so the
// model re-downloads on every cold start. /tmp is the only writable path.
if (process.env.VERCEL) {
  env.cacheDir = "/tmp/transformers-cache";
}

// Singleton: load the model once, reuse across calls.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }
  return extractorPromise;
}

// Embed one string -> number[] of length 384.
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

// Embed many strings (sequential is fine for now; optimize later).
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}
