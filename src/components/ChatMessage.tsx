"use client";

import type { Message } from "@/types";
import StructuredResponse from "./StructuredResponse";

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${isUser ? "animate-slide-in-right" : "animate-slide-in-left"}`}>
      <div
        className={`max-w-[85%] ${
          isUser
            ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-2xl rounded-br-md px-4 py-3"
            : "bg-white dark:bg-neutral-800 border border-neutral-100 dark:border-neutral-700 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"
        }`}
      >
        <p
          className={`text-sm leading-relaxed whitespace-pre-wrap ${
            isUser ? "text-white dark:text-neutral-900" : "text-neutral-700 dark:text-neutral-200"
          }`}
        >
          {isUser ? message.content : message.structured?.answer || message.content}
        </p>

        {!isUser && message.structured && (
          <StructuredResponse data={message.structured} />
        )}
      </div>
    </div>
  );
}
