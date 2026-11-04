import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("DisputeBench API Endpoints", () => {
  const app = buildServer({ isTest: true });

  it("handles GET /api/v1/bench/results", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/bench/results",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.suiteName).toBe("DisputeBench");
    expect(body.tribunal).toBeDefined();
    expect(body.tribunal.tamperDetectionRate).toBe(1.0);
    expect(body.baseline).toBeDefined();
  });

  it("handles POST /api/v1/bench/run to trigger fresh evaluation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/bench/run",
      payload: { split: "dev" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain("DisputeBench execution completed");
    expect(body.metrics.splitReported).toBe("dev");
    expect(body.metrics.totalEvaluatedCases).toBe(20);
  });
});
