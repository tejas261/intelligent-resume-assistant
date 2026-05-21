import pdf from "pdf-parse";

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const result = await pdf(buffer);
  return result.text;
}
