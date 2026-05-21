import { NextRequest, NextResponse } from "next/server";
import { processChat } from "@/lib/agent";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, message } = body;

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId and message are required" },
        { status: 400 }
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found. Please upload a resume first." },
        { status: 404 }
      );
    }

    const response = await processChat(sessionId, message);

    return NextResponse.json({ response });
  } catch (error) {
    console.error("Chat error:", error);
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return NextResponse.json(
        { error: "Rate limited by AI provider. Please wait about 30 seconds and try again." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Failed to process your question. Please try again." },
      { status: 500 }
    );
  }
}
