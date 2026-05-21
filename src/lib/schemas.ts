import { z } from "zod";

export const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  duration: z.string(),
  description: z.string(),
});

export const EducationSchema = z.object({
  degree: z.string(),
  institution: z.string(),
  year: z.string(),
});

export const ResumeDataSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  skills: z.array(z.string()),
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  summary: z.string().optional(),
});

export const StructuredOutputSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["resume", "inference"]),
  missing_data: z.array(z.string()),
});
