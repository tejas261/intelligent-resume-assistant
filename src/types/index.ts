export interface ResumeData {
  name: string;
  email?: string;
  phone?: string;
  skills: string[];
  experience: {
    title: string;
    company: string;
    duration: string;
    description: string;
  }[];
  education: {
    degree: string;
    institution: string;
    year: string;
  }[];
  summary?: string;
  raw_text: string;
}

export interface StructuredOutput {
  answer: string;
  confidence: number;
  source: "resume" | "inference";
  missing_data: string[];
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  structured?: StructuredOutput;
  timestamp: number;
}

export interface Session {
  id: string;
  resume: ResumeData;
  messages: Message[];
  created_at: number;
}

export interface ChatSession {
  id: string;
  resumeName: string;
  resume: Omit<ResumeData, "raw_text">;
  messages: Message[];
  created_at: number;
}
