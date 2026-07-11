import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@xenova/transformers"],
  // Vercel's file tracing bundles onnxruntime-node's .node binding but misses
  // the libonnxruntime.so shared library it dlopens, crashing every API route
  // at import time. Force-include the linux binaries in the function bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/onnxruntime-node/bin/napi-v3/linux/**"],
  },
};

export default nextConfig;
