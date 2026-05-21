"use client";

import { useState, useRef, useCallback } from "react";
import type { ResumeData } from "@/types";

interface ResumeUploadProps {
  onUpload: (sessionId: string, resume: ResumeData) => void;
}

export default function ResumeUpload({ onUpload }: ResumeUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const isPDF = file.type === "application/pdf";
      const isText = file.type === "text/plain" || file.name.endsWith(".txt");
      if (!isPDF && !isText) {
        setError("Please upload a PDF or text file.");
        return;
      }

      setIsLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });

          const data = await response.json();

          if (response.status === 429 && attempt < 2) {
            const wait = 20 * (attempt + 1);
            setError(`Rate limited — retrying in ${wait}s...`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            setError(null);
            continue;
          }

          if (!response.ok) {
            throw new Error(data.error || "Failed to process resume");
          }

          onUpload(data.sessionId, data.resume);
          return;
        } catch (err) {
          if (attempt === 2 || !(err instanceof Error && err.message.includes("Rate limited"))) {
            setError(
              err instanceof Error ? err.message : "Failed to process resume"
            );
            break;
          }
        }
      }

      setIsLoading(false);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteText.trim() || isLoading) return;

    const blob = new Blob([pasteText], { type: "text/plain" });
    const file = new File([blob], "resume.txt", { type: "text/plain" });
    await handleFile(file);
  }, [pasteText, isLoading, handleFile]);

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-lg mx-auto">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          w-full border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          transition-all duration-200 ease-in-out
          ${
            isDragging
              ? "border-neutral-900 dark:border-neutral-400 bg-neutral-50 dark:bg-neutral-800"
              : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50"
          }
          ${isLoading ? "pointer-events-none opacity-60" : "hover:scale-[1.01] active:scale-[0.99]"}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {isLoading ? (
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <div className="w-8 h-8 border-2 border-neutral-300 dark:border-neutral-600 border-t-neutral-900 dark:border-t-neutral-200 rounded-full animate-spin" />
            <p className="text-sm text-neutral-500 font-medium">
              {error && error.includes("retrying") ? error : "Analyzing resume..."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                Drop your resume here
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                or click to browse &middot; PDF or TXT
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="w-full mt-4">
        <button
          onClick={() => setShowPaste(!showPaste)}
          className="w-full flex items-center justify-center gap-2 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors duration-200"
        >
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          <span>{showPaste ? "hide" : "or paste text"}</span>
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        </button>

        {showPaste && (
          <div className="mt-3 animate-fade-in-up">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste resume content here..."
              disabled={isLoading}
              rows={6}
              className="w-full px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200 placeholder:text-neutral-400
                bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl resize-none outline-none
                focus:border-neutral-400 dark:focus:border-neutral-500 transition-colors duration-200 disabled:opacity-50"
            />
            <button
              onClick={handlePasteSubmit}
              disabled={!pasteText.trim() || isLoading}
              className="mt-2 w-full py-2.5 text-sm font-medium text-white dark:text-neutral-900 bg-neutral-900 dark:bg-white
                rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-[0.98] transition-all duration-200
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? "Analyzing..." : "Analyze Resume"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-500 text-center animate-fade-in-up">{error}</p>
      )}
    </div>
  );
}
