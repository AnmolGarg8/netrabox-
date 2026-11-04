import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("API Health Endpoint", () => {
  it("returns 200 OK with status ok", async () => {
    process.env.NODE_ENV = "test";
    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("netrabox-api");
  });
});
