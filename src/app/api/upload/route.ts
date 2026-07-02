import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { extractTextFromPDF } from "@/lib/pdf-parser";
import { structureResume } from "@/lib/resume-structurer";
import { createSession } from "@/lib/session";
import { ingestResume } from "@/lib/rag/ingest";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isPDF = file.type === "application/pdf";
    const isText = file.type === "text/plain" || file.name.endsWith(".txt");

    if (!isPDF && !isText) {
      return NextResponse.json(
        { error: "Only PDF and text files are supported" },
        { status: 400 }
      );
    }

    let rawText: string;

    if (isPDF) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      rawText = await extractTextFromPDF(buffer);
    } else {
      rawText = await file.text();
    }

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from the file. It may be empty or image-based." },
        { status: 400 }
      );
    }

    const resume = await structureResume(rawText);

    const sessionId = uuidv4();
    createSession({
      id: sessionId,
      resume,
      messages: [],
      created_at: Date.now(),
    });

    // Build the RAG index (chunk -> embed -> FAISS) for this resume.
    await ingestResume(sessionId, resume);

    return NextResponse.json({ sessionId, resume });
  } catch (error) {
    console.error("Upload error:", error);
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Rate limited by AI provider. Please wait about 30 seconds and try again." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Failed to process resume. Please try again." },
      { status: 500 }
    );
  }
}
