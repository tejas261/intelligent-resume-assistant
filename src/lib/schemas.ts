import { z } from "zod";

// The structuring prompt tells the LLM to use null for missing fields, and
// models often emit numbers for fields like `year`. Accept string | number |
// null | undefined and normalize, so validation reflects what LLMs actually
// return rather than rejecting the whole resume.
const llmString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? "" : String(v)));

const llmOptionalString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? undefined : String(v)));

export const ExperienceSchema = z.object({
  title: llmString,
  company: llmString,
  duration: llmString,
  description: llmString,
});

export const EducationSchema = z.object({
  degree: llmString,
  institution: llmString,
  year: llmString,
});

export const ResumeDataSchema = z.object({
  name: z.string(),
  email: llmOptionalString,
  phone: llmOptionalString,
  skills: z.array(z.string()).default([]),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  summary: llmOptionalString,
});

export const StructuredOutputSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["resume", "inference"]),
  missing_data: z.array(z.string()),
});
