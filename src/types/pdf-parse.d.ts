declare module "pdf-parse" {
  interface PDFResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdf(buffer: Buffer): Promise<PDFResult>;
  export default pdf;
}
