import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { computeMerkleRoot } from "@netrabox/core";
import { EvidenceService } from "../src/services/evidence/service.js";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import { buildServer } from "../src/server.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";

describe("Evidence System & Cryptographic Verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  function createTestService() {
    const store = new InMemoryStateStore();

    const purchase: PurchaseRecord = {
      id: "pur_ev_test_1",
      buyerId: "u_1",
      agentId: "a_1",
      merchantId: "m_1",
      title: "Evidence Verification Headphones",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 34999,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set("pur_ev_test_1", purchase);

    const service = new EvidenceService(store, privateKeyHex, publicKeyHex);
    return { store, service };
  }

  describe("Merkle Root Computation", () => {
    it("computes deterministic Merkle roots for empty, even, and odd leaf counts", () => {
      // Empty
      expect(computeMerkleRoot([])).toBe(
        "0000000000000000000000000000000000000000000000000000000000000000",
      );

      // Single leaf
      const leaf1 = "a".repeat(64);
      expect(computeMerkleRoot([leaf1])).toBe(leaf1);

      // Even (2 leaves)
      const leaf2 = "b".repeat(64);
      const root2 = computeMerkleRoot([leaf1, leaf2]);
      expect(root2).toHaveLength(64);

      // Odd (3 leaves: duplicates 3rd leaf for balanced tree)
      const leaf3 = "c".repeat(64);
      const root3 = computeMerkleRoot([leaf1, leaf2, leaf3]);
      expect(root3).toHaveLength(64);
      expect(root3).not.toBe(root2);
    });
  });

  describe("Chain Verification Invariants", () => {
    it("verifies a valid unbroken evidence chain", async () => {
      const { service } = createTestService();

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Find Sony XM5" },
      });

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "OFFERS_OBSERVED",
        actor: "agent",
        payload: { query: "Sony XM5", count: 3 },
      });

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "AGENT_REASONING",
        actor: "agent",
        payload: { rationale: "Chose best seller rating" },
      });

      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(true);
      expect(report.totalEvents).toBe(3);
      expect(report.merkleRoot).toBeDefined();
      expect(report.lastHash).toHaveLength(64);
      expect(report.brokenSeq).toBeUndefined();
    });

    it("fails verification and reports exact break when any field is modified", async () => {
      const { store, service } = createTestService();

      for (let i = 1; i <= 4; i++) {
        await service.appendEvent({
          purchaseId: "pur_ev_test_1",
          type: "AGENT_REASONING",
          actor: "agent",
          payload: { step: i },
        });
      }

      // Tamper: alter payload of event #3
      const events = store.events.get("pur_ev_test_1")!;
      events[2].payload = { step: 3, injectedMaliciousField: true };

      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(false);
      expect(report.brokenSeq).toBe(3);
      expect(report.reason).toContain("Hash mismatch at seq 3");
    });

    it("fails verification and reports exact break when an event is deleted (gap)", async () => {
      const { store, service } = createTestService();

      for (let i = 1; i <= 4; i++) {
        await service.appendEvent({
          purchaseId: "pur_ev_test_1",
          type: "AGENT_REASONING",
          actor: "agent",
          payload: { step: i },
        });
      }

      // Delete event #2 (seq 2 removed, seq 3 now follows seq 1)
      const events = store.events.get("pur_ev_test_1")!;
      events.splice(1, 1);

      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(false);
      expect(report.brokenSeq).toBe(3);
      expect(report.reason).toContain(
        "Sequence error detected at index 1: expected seq 2, got seq 3",
      );
    });

    it("fails verification and reports exact break when events are reordered", async () => {
      const { store, service } = createTestService();

      for (let i = 1; i <= 4; i++) {
        await service.appendEvent({
          purchaseId: "pur_ev_test_1",
          type: "AGENT_REASONING",
          actor: "agent",
          payload: { step: i },
        });
      }

      // Swap event #2 and event #3
      const events = store.events.get("pur_ev_test_1")!;
      const temp = events[1];
      events[1] = events[2];
      events[2] = temp;

      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(false);
      expect(report.brokenSeq).toBe(3);
      expect(report.reason).toContain(
        "Sequence error detected at index 1: expected seq 2, got seq 3",
      );
    });

    it("fails verification and reports exact break when a signature is swapped", async () => {
      const { store, service } = createTestService();

      const ev1 = await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { step: 1 },
      });

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "AGENT_REASONING",
        actor: "agent",
        payload: { step: 2 },
      });

      // Swap signature of event #1 onto event #2
      const events = store.events.get("pur_ev_test_1")!;
      events[1].signature = ev1.signature;

      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(false);
      expect(report.brokenSeq).toBe(2);
      expect(report.reason).toContain("Invalid Ed25519 signature at seq 2");
    });

    it("guarantees concurrent appends do not fork the chain or produce sequence gaps", async () => {
      const { store, service } = createTestService();

      const concurrentCount = 10;
      const tasks = Array.from({ length: concurrentCount }).map((_, idx) =>
        service.appendEvent({
          purchaseId: "pur_ev_test_1",
          type: "AGENT_REASONING",
          actor: "agent",
          payload: { concurrentIndex: idx + 1 },
        }),
      );

      // Execute all 10 simultaneously
      const results = await Promise.all(tasks);
      expect(results.length).toBe(concurrentCount);

      const events = store.events.get("pur_ev_test_1")!;
      expect(events.length).toBe(concurrentCount);

      // Verify sequence strictly 1 through 10
      const seqs = events.map((e) => e.seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // Complete cryptographic verification
      const report = await service.verifyChain("pur_ev_test_1", publicKeyHex);
      expect(report.valid).toBe(true);
      expect(report.totalEvents).toBe(concurrentCount);
    });
  });

  describe("API Endpoints & Demo Tamper Route", () => {
    it("serves evidence list, verification report, and evidence pack", async () => {
      const { store, service } = createTestService();

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Test Headphone Purchase" },
      });

      const app = buildServer({
        store,
        evidenceService: service,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        demoMode: true,
        isTest: true,
      });

      // 1. GET /purchases/:id/evidence
      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/purchases/pur_ev_test_1/evidence",
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.totalEvents).toBe(1);

      // 2. GET /purchases/:id/evidence/verify
      const verifyRes = await app.inject({
        method: "GET",
        url: "/api/v1/purchases/pur_ev_test_1/evidence/verify",
      });
      expect(verifyRes.statusCode).toBe(200);
      const verifyBody = JSON.parse(verifyRes.payload);
      expect(verifyBody.valid).toBe(true);
      expect(verifyBody.merkleRoot).toHaveLength(64);

      // 3. GET /purchases/:id/evidence-pack
      const packRes = await app.inject({
        method: "GET",
        url: "/api/v1/purchases/pur_ev_test_1/evidence-pack",
      });
      expect(packRes.statusCode).toBe(200);
      const packBody = JSON.parse(packRes.payload);
      expect(packBody.version).toBe("1.0.0");
      expect(packBody.valid).toBe(true);
      expect(packBody.publicKeyHex).toBe(publicKeyHex);
      expect(packBody.events).toHaveLength(1);
    });

    it("allows POST /demo/tamper when DEMO_MODE=true and causes subsequent verification to fail", async () => {
      const { store, service } = createTestService();

      await service.appendEvent({
        purchaseId: "pur_ev_test_1",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Legit item" },
      });

      const app = buildServer({
        store,
        evidenceService: service,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        demoMode: true,
        isTest: true,
      });

      // Trigger tamper
      const tamperRes = await app.inject({
        method: "POST",
        url: "/api/v1/demo/tamper",
        payload: {
          purchaseId: "pur_ev_test_1",
          targetSeq: 1,
          tamperedPayload: { prompt: "Tampered luxury diamond ring" },
        },
      });

      expect(tamperRes.statusCode).toBe(200);
      expect(JSON.parse(tamperRes.payload).status).toBe("tampered_silently");

      // Verify that verification now catches the tamper!
      const verifyRes = await app.inject({
        method: "GET",
        url: "/api/v1/purchases/pur_ev_test_1/evidence/verify",
      });
      const verifyBody = JSON.parse(verifyRes.payload);
      expect(verifyBody.valid).toBe(false);
      expect(verifyBody.brokenSeq).toBe(1);
      expect(verifyBody.reason).toContain("Hash mismatch at seq 1");
    });

    it("rejects POST /demo/tamper with 403 Forbidden when DEMO_MODE=false", async () => {
      const { store, service } = createTestService();

      const app = buildServer({
        store,
        evidenceService: service,
        signingPrivateKeyHex: privateKeyHex,
        demoMode: false, // Disabled!
        isTest: true,
      });

      const tamperRes = await app.inject({
        method: "POST",
        url: "/api/v1/demo/tamper",
        payload: {
          purchaseId: "pur_ev_test_1",
          targetSeq: 1,
          tamperedPayload: { price: 1 },
        },
      });

      expect(tamperRes.statusCode).toBe(403);
      expect(JSON.parse(tamperRes.payload).error).toContain("Forbidden");
    });
  });
});
