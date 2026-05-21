"use client";

import { useState, useCallback, useEffect } from "react";
import type { ResumeData, Message, ChatSession } from "@/types";
import { getChatSessions, saveChatSession } from "@/lib/chat-store";
import ResumeUpload from "@/components/ResumeUpload";
import ResumePreview from "@/components/ResumePreview";
import ChatInterface from "@/components/ChatInterface";
import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pastSessions, setPastSessions] = useState<ChatSession[]>([]);
  const [, setIsRestoring] = useState(false);

  useEffect(() => {
    getChatSessions().then(setPastSessions).catch(() => {});
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await getChatSessions();
      setPastSessions(sessions);
    } catch {}
  }, []);

  const handleUpload = useCallback(
    async (newSessionId: string, newResume: ResumeData) => {
      setSessionId(newSessionId);
      setResume(newResume);
      setMessages([]);
      const { raw_text: _omitted, ...resumeWithoutRaw } = newResume;
      await saveChatSession({
        id: newSessionId,
        resumeName: newResume.name,
        resume: resumeWithoutRaw,
        messages: [],
        created_at: Date.now(),
      });
      await refreshSessions();
    },
    [refreshSessions]
  );

  const handleUserMessage = useCallback(
    (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    },
    []
  );

  const handleAssistantMessage = useCallback(
    async (msg: Message) => {
      setMessages((prev) => {
        const updated = [...prev, msg];

        if (sessionId && resume) {
          const { raw_text: _omitted, ...resumeWithoutRaw } = resume;
          saveChatSession({
            id: sessionId,
            resumeName: resume.name,
            resume: resumeWithoutRaw,
            messages: updated,
            created_at: Date.now(),
          }).then(refreshSessions);
        }

        return updated;
      });
    },
    [sessionId, resume, refreshSessions]
  );

  const handleReset = useCallback(() => {
    setSessionId(null);
    setResume(null);
    setMessages([]);
  }, []);

  const handleSelectSession = useCallback(async (session: ChatSession) => {
    const resumeData = { ...session.resume, raw_text: "" } as ResumeData;
    setSessionId(session.id);
    setResume(resumeData);
    setMessages(session.messages);
    setIsRestoring(true);

    try {
      await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          resume: resumeData,
          messages: session.messages,
        }),
      });
    } catch {
      // Session restore failed silently — chat will still work for display
    } finally {
      setIsRestoring(false);
    }
  }, []);

  if (!sessionId || !resume) {
    return (
      <div className="flex-1 flex h-screen animate-fade-in">
        {sidebarOpen && pastSessions.length > 0 && (
          <aside className="w-72 border-r border-neutral-100 dark:border-neutral-800 shrink-0 animate-slide-in-left">
            <Sidebar
              sessions={pastSessions}
              activeSessionId={null}
              onSelectSession={handleSelectSession}
              onNewChat={handleReset}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        )}

        <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
          <div className="absolute top-5 right-5">
            <ThemeToggle />
          </div>
          {pastSessions.length > 0 && !sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="absolute top-5 left-5 p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:scale-110 active:scale-95 transition-all duration-200"
              title="Chat history"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}

          <div className="mb-10 text-center animate-fade-in-up">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
              Resume Assistant
            </h1>
            <p className="text-sm text-neutral-400 mt-2">
              Upload a resume to start analyzing
            </p>
          </div>
          <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <ResumeUpload onUpload={handleUpload} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden animate-fade-in">
      <aside className="lg:w-80 xl:w-96 border-b lg:border-b-0 lg:border-r border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0 h-full overflow-hidden relative">
        <div
          className={`absolute inset-0 h-full overflow-y-auto transition-opacity duration-250 ${
            sidebarOpen ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
          }`}
        >
          <Sidebar
            sessions={pastSessions}
            activeSessionId={sessionId}
            onSelectSession={(session) => {
              handleSelectSession(session);
              setSidebarOpen(false);
            }}
            onNewChat={handleReset}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
        <div
          className={`h-full overflow-y-auto px-6 py-3 transition-opacity duration-250 ${
            sidebarOpen ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <ResumePreview
            resume={resume}
            onReset={handleReset}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Resume Assistant
            </h1>
            <p className="text-xs text-neutral-400">
              Analyzing {resume.name}&apos;s resume
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatInterface
            sessionId={sessionId}
            messages={messages}
            onUserMessage={handleUserMessage}
            onAssistantMessage={handleAssistantMessage}
          />
        </div>
      </main>
    </div>
  );
}
