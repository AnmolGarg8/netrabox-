import type { FastifyPluginAsync } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DisputeBenchRunner, type BenchSummaryMetrics } from "@netrabox/bench";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_JSON_PATH = resolve(__dirname, "../../../../packages/bench/results.json");

export const benchRoutes: FastifyPluginAsync = async (fastify) => {
  const runner = new DisputeBenchRunner();

  /**
   * GET /bench/results
   * Returns latest DisputeBench run summary and individual case results
   */
  fastify.get("/bench/results", async (_request, reply) => {
    if (existsSync(RESULTS_JSON_PATH)) {
      try {
        const raw = readFileSync(RESULTS_JSON_PATH, "utf8");
        const data = JSON.parse(raw) as BenchSummaryMetrics;
        return reply.send(data);
      } catch {
        // Fallback to fresh run if file is corrupt
      }
    }

    const summary = await runner.runBenchmark({ split: "test" });
    return reply.send(summary);
  });

  /**
   * POST /bench/run
   * Executes DisputeBench suite against the configured LLM provider
   */
  fastify.post("/bench/run", async (request, reply) => {
    const body = (request.body as { split?: "test" | "dev" | "all" }) || {};
    const split = body.split || "test";

    const summary = await runner.runBenchmark({ split });
    return reply.send({
      message: `DisputeBench execution completed for ${summary.totalEvaluatedCases} cases (${split.toUpperCase()} set)`,
      metrics: summary,
    });
  });
};
