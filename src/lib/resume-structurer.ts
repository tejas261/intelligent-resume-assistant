import { chatWithRetry, MODEL } from "./openai";
import { ResumeDataSchema } from "./schemas";
import type { ResumeData } from "@/types";

export async function structureResume(rawText: string): Promise<ResumeData> {
  const response = await chatWithRetry({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are a resume parser. Extract structured data from the resume text provided.
Return a JSON object with these fields:
- name: string (candidate's full name)
- email: string or null
- phone: string or null
- skills: string[] (list of technical and soft skills)
- experience: array of { title, company, duration, description }
- education: array of { degree, institution, year }
- summary: string or null (professional summary if present)

Be thorough in extracting skills — include technologies, frameworks, languages, tools, and soft skills mentioned anywhere in the resume.
If a field is not present in the resume, use null for optional fields or empty arrays for list fields.
Return ONLY valid JSON, no additional text.`,
      },
      {
        role: "user",
        content: rawText,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from LLM during resume parsing");
  }

  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  const validated = ResumeDataSchema.parse(parsed);

  return {
    ...validated,
    raw_text: rawText,
  };
}
