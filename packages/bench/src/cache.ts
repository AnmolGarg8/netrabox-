import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { LLMAdapter, LLMMessage, LLMResponse, LLMToolDefinition } from "@netrabox/core";
import { z } from "zod";

export interface CacheEntry {
  model: string;
  promptHash: string;
  response: string;
  createdAt: string;
}

export function computeCacheKey(
  model: string,
  prompt: string,
  temperature: number | string = 0.1,
  responseSchemaName: string = "default",
): string {
  return createHash("sha256")
    .update(`${model}${prompt}${temperature}${responseSchemaName}`, "utf8")
    .digest("hex");
}

export class CachedLLMAdapter implements LLMAdapter {
  private baseAdapter: LLMAdapter;
  private modelName: string;
  private cacheFilePath?: string;
  public temperature: number;
  private cache: Map<string, string> = new Map();
  public cacheHits = 0;
  public cacheMisses = 0;

  constructor(
    baseAdapter: LLMAdapter,
    modelName = "default",
    cacheFilePath?: string,
    temperature = 0.1,
  ) {
    this.baseAdapter = baseAdapter;
    this.modelName = modelName;
    this.cacheFilePath = cacheFilePath;
    this.temperature = temperature;
    this.loadCache();
  }

  private loadCache(): void {
    if (!this.cacheFilePath || !existsSync(this.cacheFilePath)) {
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.cacheFilePath, "utf8")) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) {
        this.cache.set(k, v);
      }
    } catch {
      // ignore corrupt cache
    }
  }

  private persistCache(): void {
    if (!this.cacheFilePath) return;
    try {
      mkdirSync(dirname(this.cacheFilePath), { recursive: true });
      const obj: Record<string, string> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2), "utf8");
    } catch {
      // ignore write error
    }
  }

  public computeKey(prompt: string, responseSchemaName = "default"): string {
    return computeCacheKey(this.modelName, prompt, this.temperature, responseSchemaName);
  }

  public clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    if (this.cacheFilePath && existsSync(this.cacheFilePath)) {
      try {
        unlinkSync(this.cacheFilePath);
      } catch {
        // ignore
      }
    }
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const prompt = messages.map((m) => `${m.role}:${m.content}`).join("\n");
    const key = this.computeKey(prompt, "chat");

    if (this.cache.has(key)) {
      this.cacheHits++;
      return { content: this.cache.get(key)! };
    }

    this.cacheMisses++;
    const res = await this.baseAdapter.chat(messages, tools);
    this.cache.set(key, res.content);
    this.persistCache();
    return res;
  }

  async structuredOutput<T>(
    prompt: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    systemPrompt?: string,
  ): Promise<T> {
    const schemaName =
      (schema as any)?.description ||
      (schema as any)?._def?.description ||
      schema.constructor?.name ||
      "structured";
    const combinedPrompt = `${systemPrompt || ""}\n${prompt}`;
    const key = this.computeKey(combinedPrompt, schemaName);

    if (this.cache.has(key)) {
      this.cacheHits++;
      const cached = this.cache.get(key)!;
      try {
        const json = JSON.parse(cached);
        return schema.parse(json);
      } catch {
        // Fallback to fresh call if cached content doesn't match schema
      }
    }

    this.cacheMisses++;
    const res = await this.baseAdapter.structuredOutput(prompt, schema, systemPrompt);
    this.cache.set(key, JSON.stringify(res));
    this.persistCache();
    return res;
  }
}
