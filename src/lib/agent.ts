import { chatWithRetry, MODEL } from "./openai";
import { getSession, updateSession } from "./session";
import { toolDefinitions, executeTool } from "./tools";
import { StructuredOutputSchema } from "./schemas";
import type { StructuredOutput, Message } from "@/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_TOOL_ITERATIONS = 3;

function buildSystemPrompt(resumeJSON: string): string {
  return `You are a strict hiring assistant AI. You analyze resumes and answer questions about candidates based ONLY on the data present in their resume.

RULES:
- Only state facts that are present in the resume data.
- If information is not in the resume, explicitly say "Not mentioned in resume" and list the missing items in missing_data.
- Never fabricate or assume information not present in the resume.
- Use the provided tools to look up specific resume sections or match skills when appropriate, rather than relying on memory.
- Set confidence based on how directly the resume data supports your answer:
  1.0 = directly stated in resume
  0.7-0.9 = reasonable inference from resume data
  0.5-0.6 = weak inference
  Below 0.5 = insufficient data, prefer saying "Not mentioned in resume"
- Set source to "resume" when the answer comes directly from resume data, or "inference" when you're drawing conclusions from the data.

RESUME DATA:
${resumeJSON}

You MUST respond with a JSON object in this exact format (no additional text):
{
  "answer": "your detailed answer here",
  "confidence": 0.0 to 1.0,
  "source": "resume" or "inference",
  "missing_data": ["list", "of", "missing", "items"] or []
}`;
}

export async function processChat(
  sessionId: string,
  userMessage: string
): Promise<StructuredOutput> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const { resume } = session;
  const resumeJSON = JSON.stringify(
    { ...resume, raw_text: resume.raw_text.slice(0, 8000) },
    null,
    2
  );

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(resumeJSON) },
  ];

  for (const msg of session.messages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else {
      messages.push({
        role: "assistant",
        content: msg.structured
          ? JSON.stringify(msg.structured)
          : msg.content,
      });
    }
  }

  messages.push({ role: "user", content: userMessage });

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const payload = {
      model: MODEL,
      messages,
      tools: toolDefinitions,
    };
    console.log(
      `\n${"=".repeat(60)}\n[LLM CALL] Iteration ${iterations}/${MAX_TOOL_ITERATIONS}\n${"=".repeat(60)}\n${JSON.stringify(payload, null, 2)}\n${"=".repeat(60)}\n`
    );

    const response = await chatWithRetry(payload);

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("No response from LLM");
    }

    const assistantMessage = choice.message;

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== "function") continue;
        const fn = toolCall.function;
        const args = JSON.parse(fn.arguments);
        const result = executeTool(fn.name, args, resume);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      continue;
    }

    const content = assistantMessage.content;
    if (!content) {
      throw new Error("Empty response from LLM");
    }

    const structured = parseStructuredOutput(content);

    const userMsg: Message = {
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    };

    const assistantMsg: Message = {
      role: "assistant",
      content: structured.answer,
      structured,
      timestamp: Date.now(),
    };

    updateSession(sessionId, {
      messages: [...session.messages, userMsg, assistantMsg],
    });

    return structured;
  }

  const fallbackMessages: ChatCompletionMessageParam[] = [
    ...messages,
    {
      role: "user" as const,
      content:
        "Please provide your final answer now in the required JSON format: { answer, confidence, source, missing_data }",
    },
  ];
  const fallbackPayload = {
    model: MODEL,
    messages: fallbackMessages,
  };
  console.log(
    `\n${"=".repeat(60)}\n[LLM CALL] Fallback (tools exhausted)\n${"=".repeat(60)}\n${JSON.stringify(fallbackPayload, null, 2)}\n${"=".repeat(60)}\n`
  );

  const fallbackResponse = await chatWithRetry(fallbackPayload);

  const fallbackContent = fallbackResponse.choices[0]?.message?.content || "";
  const structured = parseStructuredOutput(fallbackContent);

  const userMsg: Message = {
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
  };

  const assistantMsg: Message = {
    role: "assistant",
    content: structured.answer,
    structured,
    timestamp: Date.now(),
  };

  updateSession(sessionId, {
    messages: [...session.messages, userMsg, assistantMsg],
  });

  return structured;
}

function parseStructuredOutput(content: string): StructuredOutput {
  try {
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    return StructuredOutputSchema.parse(parsed);
  } catch {
    return {
      answer: content,
      confidence: 0.5,
      source: "inference",
      missing_data: ["Response format validation failed"],
    };
  }
}
