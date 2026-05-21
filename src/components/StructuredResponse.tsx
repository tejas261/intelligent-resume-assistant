"use client";

import type { StructuredOutput } from "@/types";

interface StructuredResponseProps {
  data: StructuredOutput;
}

export default function StructuredResponse({ data }: StructuredResponseProps) {
  const confidencePercent = Math.round(data.confidence * 100);

  const confidenceColor =
    data.confidence >= 0.7
      ? "bg-emerald-500"
      : data.confidence >= 0.5
        ? "bg-amber-500"
        : "bg-red-400";

  const confidenceLabel =
    data.confidence >= 0.7
      ? "text-emerald-600"
      : data.confidence >= 0.5
        ? "text-amber-600"
        : "text-red-500";

  return (
    <div className="flex flex-col gap-2.5 mt-2.5 pt-2.5 border-t border-neutral-100 dark:border-neutral-700 animate-fade-in" style={{ animationDelay: "150ms" }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-16 h-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${confidenceColor}`}
              style={{ width: `${confidencePercent}%`, transitionDelay: "300ms" }}
            />
          </div>
          <span className={`text-xs font-medium ${confidenceLabel}`}>
            {confidencePercent}%
          </span>
        </div>

        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            data.source === "resume"
              ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400"
              : "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400"
          }`}
        >
          {data.source === "resume" ? "From resume" : "Inference"}
        </span>
      </div>

      {data.missing_data.length > 0 && (
        <div className="flex items-start gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-neutral-300 dark:text-neutral-500 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            />
          </svg>
          <p className="text-xs text-neutral-400">
            Not in resume: {data.missing_data.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
