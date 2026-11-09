import { z } from "zod";
import type { LLMAdapter, LLMMessage, LLMResponse, LLMToolDefinition } from "./adapter.js";
import { extractConstraintsHeuristic } from "../intent-guard/extractor.js";

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
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    systemPrompt?: string,
  ): Promise<T> {
    if (this.customHandler) {
      const messages: LLMMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });
      const res = await this.customHandler(messages);
      const parsed = typeof res.content === "string" ? JSON.parse(res.content) : res.content;
      return schema.parse(parsed);
    }

    // If prompt asks to extract constraints from user prompt
    if (
      prompt.includes("extract constraints") ||
      prompt.includes("untrusted_user_instruction") ||
      prompt.includes("StructuredConstraints")
    ) {
      try {
        const extracted = extractConstraintsHeuristic(prompt);
        const parsed = schema.safeParse(extracted);
        if (parsed.success) {
          return parsed.data;
        }
      } catch {
        // Fall back below
      }
    }

    const eventIdMatches = Array.from(prompt.matchAll(/\[Event(?:\s+ID)?:?\s*([^\]]+)\]/gi)).map(
      (m) => m[1].trim(),
    );
    const citingMatches = Array.from(prompt.matchAll(/citing\s*\[([^\]]+)\]/gi)).flatMap((m) =>
      m[1].split(",").map((s) => s.trim()),
    );
    const combinedIds = Array.from(new Set([...eventIdMatches, ...citingMatches])).filter(
      (id) => id && !id.includes(" "),
    );
    const validIds = combinedIds.length > 0 ? [combinedIds[0]] : ["ev_genesis"];

    if (prompt.includes("Buyer Advocate") || prompt.includes("buyer_advocate")) {
      const mockBrief = {
        role: "buyer_advocate",
        claims: [
          {
            claim: "Buyer was delivered incorrect goods or overcharged.",
            citedEvidenceIds: validIds,
          },
        ],
        citedEvidenceIds: validIds,
        faultAssessment: "Merchant or agent fault",
      };
      const parsed = schema.safeParse(mockBrief);
      if (parsed.success) return parsed.data;
    }

    if (prompt.includes("Merchant Advocate") || prompt.includes("merchant_advocate")) {
      const mockBrief = {
        role: "merchant_advocate",
        claims: [
          {
            claim: "Merchant fulfilled order accurately according to received specifications.",
            citedEvidenceIds: validIds,
          },
        ],
        citedEvidenceIds: validIds,
        faultAssessment: "Merchant fulfilled terms",
      };
      const parsed = schema.safeParse(mockBrief);
      if (parsed.success) return parsed.data;
    }

    if (
      prompt.includes("Chief Judge") ||
      prompt.includes("Tribunal Verdict") ||
      prompt.includes("DISPUTE CASE") ||
      prompt.includes("judicial verdict")
    ) {
      const mockVerdict = {
        classification: "AGENT_EXCEEDED_INSTRUCTIONS",
        liabilitySplit: { buyer: 0, agentProvider: 100, merchant: 0 },
        refundAmountMinor: 34999,
        confidence: 0.95,
        citedEvidenceIds: validIds,
        reasoning: "Agent exceeded user instructions based on verified evidence ledger.",
        recommendedAction: "REFUND_FULL",
      };
      const parsed = schema.safeParse(mockVerdict);
      if (parsed.success) return parsed.data;
    }

    // Fallback: parse minimal defaults from schema if possible
    return schema.parse({});
  }
}
