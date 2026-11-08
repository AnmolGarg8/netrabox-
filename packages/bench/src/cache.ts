import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LLMAdapter, LLMMessage, LLMResponse, LLMToolDefinition } from "@netrabox/core";
import { z } from "zod";

export interface CacheEntry {
  model: string;
  promptHash: string;
  response: string;
  createdAt: string;
}

export class CachedLLMAdapter implements LLMAdapter {
  private baseAdapter: LLMAdapter;
  private modelName: string;
  private cacheFilePath?: string;
  private cache: Map<string, string> = new Map();
  public cacheHits = 0;
  public cacheMisses = 0;

  constructor(baseAdapter: LLMAdapter, modelName = "default", cacheFilePath?: string) {
    this.baseAdapter = baseAdapter;
    this.modelName = modelName;
    this.cacheFilePath = cacheFilePath;
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

  private computeKey(prompt: string): string {
    return createHash("sha256").update(`${this.modelName}:${prompt}`).digest("hex");
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const prompt = messages.map((m) => `${m.role}:${m.content}`).join("\n");
    const key = this.computeKey(prompt);

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
    const combinedPrompt = `${systemPrompt || ""}\n${prompt}`;
    const key = this.computeKey(combinedPrompt);

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
