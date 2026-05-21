"use client";

import type { ChatSession } from "@/types";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  onNewChat: () => void;
  onClose: () => void;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onClose,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900 animate-in slide-in-from-left duration-200">
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Chats</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:scale-110 active:scale-95 transition-all duration-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <button
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-200
            bg-neutral-50 dark:bg-neutral-800 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-700 active:scale-[0.98] transition-all duration-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {sessions.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center mt-8">
            No past sessions
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map((session, i) => {
              const isActive = session.id === activeSessionId;
              const firstUserMsg = session.messages.find(
                (m) => m.role === "user"
              );

              return (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session);
                    onClose();
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-200 animate-fade-in-up ${
                    isActive
                      ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <p
                    className={`text-sm font-medium truncate ${
                      isActive ? "text-white dark:text-neutral-900" : "text-neutral-800 dark:text-neutral-100"
                    }`}
                  >
                    {session.resumeName}
                  </p>
                  {firstUserMsg && (
                    <p
                      className={`text-xs truncate mt-0.5 ${
                        isActive ? "text-neutral-300 dark:text-neutral-500" : "text-neutral-400"
                      }`}
                    >
                      {firstUserMsg.content}
                    </p>
                  )}
                  <p
                    className={`text-xs mt-1 ${
                      isActive ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-300 dark:text-neutral-600"
                    }`}
                  >
                    {timeAgo(session.created_at)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
