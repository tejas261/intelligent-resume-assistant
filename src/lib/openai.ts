import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

export const MODEL = "llama-3.3-70b-versatile";

export async function chatWithRetry(
  params: ChatCompletionCreateParamsNonStreaming,
  maxRetries = 3
): Promise<ChatCompletion> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await openai.chat.completions.create(params) as ChatCompletion;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < maxRetries) {
        const retryAfter = (err as { headers?: { get?: (k: string) => string | null } }).headers?.get?.("retry-after");
        const delay = retryAfter
          ? Math.max(parseInt(retryAfter, 10) * 1000, 5000)
          : Math.min(10000 * Math.pow(2, attempt), 60000);
        console.log(`Rate limited (429). Waiting ${(delay / 1000).toFixed(0)}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Rate limit exceeded. Please wait a moment and try again.");
}
