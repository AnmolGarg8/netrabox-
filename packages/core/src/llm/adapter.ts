import { createHash } from "node:crypto";
import { z } from "zod";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  cached?: boolean;
}

export interface LLMAdapter {
  chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse>;
  structuredOutput<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    systemPrompt?: string,
  ): Promise<T>;
}

export function computeLLMCacheKey(
  model: string,
  prompt: string,
  temperature: number | string = 0.1,
  responseSchemaName: string = "default",
): string {
  return createHash("sha256")
    .update(`${model}${prompt}${temperature}${responseSchemaName}`, "utf8")
    .digest("hex");
}

/**
 * In-memory response cache keyed by sha256(model + prompt + temperature + response schema name)
 */
export class LLMResponseCache {
  private cache = new Map<string, string>();

  public getCacheKey(
    model: string,
    input: string,
    temperature: number | string = 0.1,
    responseSchemaName: string = "default",
  ): string {
    return computeLLMCacheKey(model, input, temperature, responseSchemaName);
  }

  public get<T>(key: string): T | null {
    const raw = this.cache.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public set(key: string, value: unknown): void {
    this.cache.set(key, JSON.stringify(value));
  }

  public clear(): void {
    this.cache.clear();
  }
}
