import type { ResumeData } from "@/types";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { semanticSearch } from "./rag/vector-store";

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Semantically search the candidate's full resume using RAG (embeddings + vector similarity). Use this for open-ended, conceptual, or fuzzy questions where the exact wording may differ from the resume (e.g. 'does this candidate have leadership experience?', 'what backend work have they done?'). Returns the most relevant passages with similarity scores.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The natural-language query to search for.",
          },
          top_k: {
            type: "number",
            description: "Number of passages to retrieve (default 4).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_resume_section",
      description:
        "Look up a specific section of the candidate's resume. Use this to get detailed information about their skills, experience, education, summary, or contact details.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["skills", "experience", "education", "summary", "contact"],
            description: "The resume section to retrieve",
          },
        },
        required: ["section"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "match_skills",
      description:
        "Check whether the candidate has specific skills. Compares required skills against the candidate's listed skills and returns matches, gaps, and a match percentage.",
      parameters: {
        type: "object",
        properties: {
          required_skills: {
            type: "array",
            items: { type: "string" },
            description: "List of skills to check for",
          },
        },
        required: ["required_skills"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_keywords",
      description:
        "Extract the most frequently occurring keywords from resume text. Useful for identifying key themes, technologies, and domain expertise.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["full", "experience", "skills", "education"],
            description: "Which part of the resume to extract keywords from",
          },
          top_n: {
            type: "number",
            description: "Number of top keywords to return (default 10)",
          },
        },
        required: ["section"],
      },
    },
  },
];

export function searchResumeSection(
  resume: ResumeData,
  section: string
): string {
  switch (section) {
    case "skills":
      return resume.skills.length > 0
        ? `Skills: ${resume.skills.join(", ")}`
        : "No skills listed in resume.";

    case "experience":
      if (resume.experience.length === 0) return "No experience listed.";
      return resume.experience
        .map(
          (e) =>
            `${e.title} at ${e.company} (${e.duration})\n${e.description}`
        )
        .join("\n\n");

    case "education":
      if (resume.education.length === 0) return "No education listed.";
      return resume.education
        .map((e) => `${e.degree} from ${e.institution} (${e.year})`)
        .join("\n");

    case "summary":
      return resume.summary || "No summary provided in resume.";

    case "contact":
      const parts: string[] = [`Name: ${resume.name}`];
      if (resume.email) parts.push(`Email: ${resume.email}`);
      if (resume.phone) parts.push(`Phone: ${resume.phone}`);
      return parts.join("\n");

    default:
      return "Unknown section requested.";
  }
}

export function matchSkills(
  resume: ResumeData,
  requiredSkills: string[]
): { matched: string[]; missing: string[]; match_percentage: number } {
  const resumeSkillsLower = resume.skills.map((s) => s.toLowerCase());

  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of requiredSkills) {
    const found = resumeSkillsLower.some(
      (rs) => rs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(rs)
    );
    if (found) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  return {
    matched,
    missing,
    match_percentage:
      requiredSkills.length > 0
        ? Math.round((matched.length / requiredSkills.length) * 100)
        : 0,
  };
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "this", "that",
  "these", "those", "i", "we", "you", "he", "she", "it", "they", "me",
  "us", "him", "her", "them", "my", "our", "your", "his", "its", "their",
  "as", "if", "not", "no", "so", "up", "out", "about", "into", "over",
  "after", "also", "each", "other", "all", "such", "more", "very",
]);

export function extractKeywords(
  resume: ResumeData,
  section: string,
  topN: number = 10
): { keyword: string; count: number }[] {
  let text: string;

  switch (section) {
    case "experience":
      text = resume.experience.map((e) => e.description).join(" ");
      break;
    case "skills":
      text = resume.skills.join(" ");
      break;
    case "education":
      text = resume.education
        .map((e) => `${e.degree} ${e.institution}`)
        .join(" ");
      break;
    default:
      text = resume.raw_text;
  }

  const words = text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s+#.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([keyword, count]) => ({ keyword, count }));
}

export interface ToolContext {
  resume: ResumeData;
  sessionId: string;
}

// Minimum similarity for a retrieved chunk to be considered relevant.
// Below this we tell the model nothing was found, so it grounds its
// "Not mentioned in resume" guardrail in retrieval rather than guessing.
const RELEVANCE_THRESHOLD = 0.25;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const { resume, sessionId } = ctx;

  switch (name) {
    case "semantic_search": {
      const results = await semanticSearch(
        sessionId,
        args.query as string,
        (args.top_k as number) ?? 4
      );
      const relevant = results.filter((r) => r.score >= RELEVANCE_THRESHOLD);
      if (relevant.length === 0) {
        return JSON.stringify({
          results: [],
          note: "No sufficiently relevant passages found in the resume for this query.",
        });
      }
      return JSON.stringify({
        results: relevant.map((r) => ({
          text: r.text,
          score: Number(r.score.toFixed(3)),
        })),
      });
    }
    case "search_resume_section":
      return searchResumeSection(resume, args.section as string);
    case "match_skills":
      return JSON.stringify(
        matchSkills(resume, args.required_skills as string[])
      );
    case "extract_keywords":
      return JSON.stringify(
        extractKeywords(resume, args.section as string, args.top_n as number)
      );
    default:
      return JSON.stringify({ error: "Unknown tool" });
  }
}
