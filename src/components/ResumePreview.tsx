"use client";

import type { ResumeData } from "@/types";

interface ResumePreviewProps {
  resume: ResumeData;
  onReset: () => void;
  onOpenSidebar: () => void;
}

export default function ResumePreview({
  resume,
  onReset,
  onOpenSidebar,
}: ResumePreviewProps) {
  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onOpenSidebar}
            className="p-1.5 -ml-1 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:scale-110 active:scale-95 transition-all duration-200"
            title="Chat history"
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
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </button>
        </div>
        <button
          onClick={onReset}
          className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:scale-105 active:scale-95 transition-all duration-200"
        >
          New resume
        </button>
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: "50ms" }}>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{resume.name}</h2>
        {resume.email && (
          <p className="text-xs text-neutral-400 mt-0.5">{resume.email}</p>
        )}
        {resume.phone && (
          <p className="text-xs text-neutral-400">{resume.phone}</p>
        )}
      </div>

      {resume.summary && (
        <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
            Summary
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-3">
            {resume.summary}
          </p>
        </div>
      )}

      {resume.skills.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Skills
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {resume.skills.slice(0, 12).map((skill) => (
              <span
                key={skill}
                className="px-2.5 py-1 text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 rounded-full"
              >
                {skill}
              </span>
            ))}
            {resume.skills.length > 12 && (
              <span className="px-2.5 py-1 text-xs text-neutral-400 rounded-full">
                +{resume.skills.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {resume.experience.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Experience
          </h3>
          <div className="space-y-2.5">
            {resume.experience.slice(0, 3).map((exp, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  {exp.title}
                </p>
                <p className="text-xs text-neutral-400">
                  {exp.company} &middot; {exp.duration}
                </p>
              </div>
            ))}
            {resume.experience.length > 3 && (
              <p className="text-xs text-neutral-400">
                +{resume.experience.length - 3} more positions
              </p>
            )}
          </div>
        </div>
      )}

      {resume.education.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: "250ms" }}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Education
          </h3>
          <div className="space-y-2">
            {resume.education.map((edu, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  {edu.degree}
                </p>
                <p className="text-xs text-neutral-400">
                  {edu.institution} &middot; {edu.year}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
