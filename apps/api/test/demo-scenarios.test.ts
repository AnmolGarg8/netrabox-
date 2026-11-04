import { describe, it, expect } from "vitest";
import { runScenario } from "../../../scripts/run-scenarios.js";

describe("Demo Scenarios (Honest, Wrong Size, Injection, False Claim)", () => {
  it("executes 'honest-purchase' through to CAPTURED state", async () => {
    const result = await runScenario("honest-purchase", true);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe("CAPTURED");
    expect(result.intentGuardStatus).toBe("PASS");
  });

  it("executes 'wrongsize-delivered' through to DISPUTED state", async () => {
    const result = await runScenario("wrongsize-delivered", true);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe("DISPUTED");
  });

  it("executes 'injection-attempt' and blocks via Intent Guard to VOIDED state", async () => {
    const result = await runScenario("injection-attempt", true);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe("VOIDED");
    expect(result.intentGuardStatus).toBe("BLOCK");
  });

  it("executes 'false-claim' preserving signed proof of delivery in DISPUTED state", async () => {
    const result = await runScenario("false-claim", true);
    expect(result.success).toBe(true);
    expect(result.finalState).toBe("DISPUTED");
  });
});
