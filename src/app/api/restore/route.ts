import { NextRequest, NextResponse } from "next/server";
import { createSession, getSession } from "@/lib/session";
import type { ResumeData, Message } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, resume, messages } = body as {
      sessionId: string;
      resume: ResumeData;
      messages: Message[];
    };

    if (!sessionId || !resume) {
      return NextResponse.json(
        { error: "sessionId and resume are required" },
        { status: 400 }
      );
    }

    if (getSession(sessionId)) {
      return NextResponse.json({ ok: true });
    }

    createSession({
      id: sessionId,
      resume,
      messages: messages || [],
      created_at: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Restore error:", error);
    return NextResponse.json(
      { error: "Failed to restore session" },
      { status: 500 }
    );
  }
}
