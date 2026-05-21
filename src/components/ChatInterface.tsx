"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, StructuredOutput } from "@/types";
import ChatMessage from "./ChatMessage";

interface ChatInterfaceProps {
  sessionId: string;
  messages: Message[];
  onUserMessage: (msg: Message) => void;
  onAssistantMessage: (msg: Message) => void;
  readOnly?: boolean;
}

const STARTER_QUESTIONS = [
  "Summarize this resume",
  "What are the key skills?",
  "Evaluate for a senior role",
  "Years of experience?",
];

export default function ChatInterface({
  sessionId,
  messages,
  onUserMessage,
  onAssistantMessage,
  readOnly = false,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };

      setInput("");
      setIsLoading(true);
      onUserMessage(userMsg);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text.trim() }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to get response");
        }

        const structured: StructuredOutput = data.response;
        const assistantMsg: Message = {
          role: "assistant",
          content: structured.answer,
          structured,
          timestamp: Date.now(),
        };

        onAssistantMessage(assistantMsg);
      } catch (err) {
        const errorMsg: Message = {
          role: "assistant",
          content:
            err instanceof Error ? err.message : "Something went wrong",
          structured: {
            answer:
              err instanceof Error ? err.message : "Something went wrong",
            confidence: 0,
            source: "inference",
            missing_data: ["Error processing request"],
          },
          timestamp: Date.now(),
        };
        onAssistantMessage(errorMsg);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [sessionId, isLoading, onUserMessage, onAssistantMessage]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !readOnly && (
          <div className="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
            <p className="text-sm text-neutral-400 animate-fade-in-up">
              Ask anything about this resume
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_QUESTIONS.map((q, i) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800
                    rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:scale-105 active:scale-95 transition-all duration-200 animate-fade-in-up"
                  style={{ animationDelay: `${i * 75}ms` }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-white dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-500 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {readOnly ? (
        <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 py-3">
          <div className="flex items-center justify-center gap-2 bg-neutral-50 dark:bg-neutral-800 rounded-xl px-4 py-2.5">
            <svg className="w-3.5 h-3.5 text-neutral-300 dark:text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <p className="text-xs text-neutral-400">
              Past session &middot; Upload a new resume to chat
            </p>
          </div>
        </div>
      ) : (
        <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2 bg-neutral-50 dark:bg-neutral-800 rounded-xl px-4 py-2.5">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask about this resume..."
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400
                outline-none disabled:opacity-50 transition-opacity duration-200"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300
                disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
