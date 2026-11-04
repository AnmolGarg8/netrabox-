import { describe, it, expect } from "vitest";
import { verifyEvidenceChain, MockLLMAdapter } from "@netrabox/core";
import {
  loadBenchmarkCases,
  generateBenchmarkCases,
  computeMacroF1,
  DisputeBenchRunner,
  CachedLLMAdapter,
} from "../src/index.js";

describe("DisputeBench Suite", () => {
  describe("Dataset Generation & Integrity", () => {
    const cases = generateBenchmarkCases();

    it("generates 52 total curated dispute cases", () => {
      expect(cases.length).toBe(52);
    });

    it("partitions cases cleanly into dev (20) and test (32) sets", () => {
      const devCases = cases.filter((c) => c.split === "dev");
      const testCases = cases.filter((c) => c.split === "test");

      expect(devCases.length).toBe(20);
      expect(testCases.length).toBe(32);
      expect(devCases.length + testCases.length).toBe(52);
    });

    it("covers every primary tribunal classification", () => {
      const categories = new Set(cases.map((c) => c.groundTruth.classification));
      expect(categories.has("AGENT_EXCEEDED_INSTRUCTIONS")).toBe(true);
      expect(categories.has("MERCHANT_MISDESCRIBED")).toBe(true);
      expect(categories.has("INSTRUCTION_AMBIGUOUS")).toBe(true);
      expect(categories.has("DELIVERY_FAILURE")).toBe(true);
      expect(categories.has("FALSE_CLAIM")).toBe(true);
      expect(categories.has("NO_FAULT")).toBe(true);
      expect(categories.has("BLOCKED")).toBe(true);
    });

    it("includes adversarial subsets: tampered, reordered, forged signatures, prompt injection, rogue agent", () => {
      const adversarial = cases.filter((c) => c.isAdversarial);
      expect(adversarial.length).toBeGreaterThanOrEqual(12);

      const advTypes = new Set(adversarial.map((c) => c.adversarialType));
      expect(advTypes.has("tampered")).toBe(true);
      expect(advTypes.has("reordered")).toBe(true);
      expect(advTypes.has("forged_signature")).toBe(true);
      expect(advTypes.has("injection_merchant")).toBe(true);
      expect(advTypes.has("injection_buyer")).toBe(true);
      expect(advTypes.has("false_rogue_agent")).toBe(true);
      expect(advTypes.has("contradictory")).toBe(true);
    });
  });

  describe("Step 1 Deterministic Tamper & Forgery Detection", () => {
    const cases = loadBenchmarkCases();

    it("catches 100% of tampered, reordered, and forged signature chains", () => {
      const blockedCases = cases.filter((c) => c.groundTruth.classification === "BLOCKED");
      expect(blockedCases.length).toBeGreaterThan(0);

      for (const bCase of blockedCases) {
        const verification = verifyEvidenceChain(bCase.evidenceChain, bCase.signerPublicKeyHex);
        expect(verification.valid).toBe(false);
        expect(verification.reason).toBeDefined();
      }
    });

    it("validates 100% of untampered chains", () => {
      const validCases = cases.filter(
        (c) => c.groundTruth.classification !== "BLOCKED" && !c.groundTruth.isAdversarial,
      );

      for (const vCase of validCases) {
        const verification = verifyEvidenceChain(vCase.evidenceChain, vCase.signerPublicKeyHex);
        expect(verification.valid).toBe(true);
      }
    });
  });

  describe("Metrics Engine", () => {
    it("computes macro F1 accurately across classes", () => {
      const preds = ["AGENT_EXCEEDED_INSTRUCTIONS", "MERCHANT_MISDESCRIBED", "FALSE_CLAIM"];
      const actuals = ["AGENT_EXCEEDED_INSTRUCTIONS", "MERCHANT_MISDESCRIBED", "FALSE_CLAIM"];

      const f1 = computeMacroF1(preds, actuals);
      expect(f1).toBe(1.0);
    });

    it("handles zero matches with zero F1 score", () => {
      const preds = ["AGENT_EXCEEDED_INSTRUCTIONS"];
      const actuals = ["MERCHANT_MISDESCRIBED"];

      const f1 = computeMacroF1(preds, actuals);
      expect(f1).toBe(0.0);
    });
  });

  describe("CachedLLMAdapter", () => {
    it("caches responses by hash and avoids redundant calls", async () => {
      let callCount = 0;
      const baseAdapter = new MockLLMAdapter(async () => {
        callCount++;
        return { content: JSON.stringify({ cached: true }) };
      });

      const cachedAdapter = new CachedLLMAdapter(baseAdapter, "test-model");

      // 1st call: cache miss
      const res1 = await cachedAdapter.chat([{ role: "user", content: "Repeatable prompt" }]);
      expect(callCount).toBe(1);
      expect(cachedAdapter.cacheHits).toBe(0);
      expect(cachedAdapter.cacheMisses).toBe(1);
      expect(res1.content).toContain("cached");

      // 2nd call with identical prompt: cache hit!
      const res2 = await cachedAdapter.chat([{ role: "user", content: "Repeatable prompt" }]);
      expect(callCount).toBe(1); // Not incremented!
      expect(cachedAdapter.cacheHits).toBe(1);
      expect(res2.content).toBe(res1.content);
    });
  });

  describe("End-to-End DisputeBench Execution", () => {
    it("executes bench suite and produces results.json & results.md matching target criteria", async () => {
      const runner = new DisputeBenchRunner({ useCache: false });
      const summary = await runner.runBenchmark({ split: "test" });

      expect(summary.totalEvaluatedCases).toBe(32);
      expect(summary.splitReported).toBe("test");

      // Target criteria from SPEC.md:
      // 1. Classification accuracy >= 85-90%
      expect(summary.tribunal.classificationAccuracy).toBeGreaterThanOrEqual(0.85);

      // 2. 100% tamper detection rate
      expect(summary.tribunal.tamperDetectionRate).toBe(1.0);

      // 3. Baseline has 0% tamper detection rate
      expect(summary.baseline.tamperDetectionRate).toBe(0.0);

      // 4. Mean refund error is lower in tribunal than baseline
      expect(summary.tribunal.meanRefundErrorMinor).toBeLessThan(
        summary.baseline.meanRefundErrorMinor,
      );

      // 5. Zero policy violations in tribunal
      expect(summary.tribunal.policyViolations).toBe(0);
      expect(summary.baseline.policyViolations).toBeGreaterThan(0);
    });
  });
});
