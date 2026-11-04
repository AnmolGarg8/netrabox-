import { z } from "zod";
import type { LLMAdapter, LLMMessage, LLMResponse, LLMToolDefinition } from "./adapter.js";

export type MockHandler = (
  messages: LLMMessage[],
  tools?: LLMToolDefinition[],
) => Promise<LLMResponse> | LLMResponse;

export class MockLLMAdapter implements LLMAdapter {
  private customHandler?: MockHandler;

  constructor(customHandler?: MockHandler) {
    this.customHandler = customHandler;
  }

  public setHandler(handler: MockHandler): void {
    this.customHandler = handler;
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    if (this.customHandler) {
      return await this.customHandler(messages, tools);
    }

    const lastMsg = messages[messages.length - 1]?.content || "";

    // Heuristic: simulate intent parsing
    if (lastMsg.includes("Sony") || lastMsg.includes("Headphones")) {
      return {
        content: "I understood your shopping request for Sony Headphones.",
        toolCalls: tools?.some((t) => t.name === "search_offers")
          ? [
              {
                id: "call_search_1",
                name: "search_offers",
                arguments: { query: "Sony WH-1000XM5" },
              },
            ]
          : undefined,
      };
    }

    return {
      content: "Default mock LLM response.",
    };
  }

  async structuredOutput<T>(
    prompt: string,
    schema: z.ZodType<T>,
    _systemPrompt?: string,
  ): Promise<T> {
    // If prompt asks to extract constraints from user prompt
    if (
      prompt.includes("extract constraints") ||
      prompt.includes("budget") ||
      prompt.includes("Sony")
    ) {
      const mockConstraints = {
        budgetMinor: 36000,
        brand: "Sony",
        color: "black",
        mustHaves: ["noise canceling"],
        forbidden: ["refurbished"],
        quantity: 1,
      };

      const parsed = schema.safeParse(mockConstraints);
      if (parsed.success) {
        return parsed.data;
      }
    }

    // Fallback: parse minimal defaults from schema if possible
    return schema.parse({});
  }
}
