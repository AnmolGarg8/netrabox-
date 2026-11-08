import { z } from "zod";
import type { LLMAdapter, LLMMessage, LLMResponse, LLMToolDefinition } from "./adapter.js";
import { LLMResponseCache } from "./adapter.js";

export class GeminiLLMAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private cache = new LLMResponseCache();

  constructor(apiKey: string, model = "gemini-1.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], _tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const cacheKey = this.cache.getCacheKey(this.model, prompt);
    const cached = this.cache.get<LLMResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const result: LLMResponse = { content: text };
    this.cache.set(cacheKey, result);
    return result;
  }

  async structuredOutput<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, any>,
    systemPrompt?: string,
  ): Promise<T> {
    const fullPrompt = `${systemPrompt ? systemPrompt + "\n\n" : ""}User Request:\n${prompt}\n\nRespond ONLY with valid JSON matching the requested structure.`;
    const response = await this.chat([
      { role: "system", content: systemPrompt || "You are an assistant that outputs only JSON." },
      { role: "user", content: fullPrompt },
    ]);

    let cleaned = response.content.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsedJson = JSON.parse(cleaned);
    return schema.parse(parsedJson);
  }
}
