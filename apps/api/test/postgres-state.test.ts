import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { generateEd25519Keypair, type EvidenceEvent } from "@netrabox/core";
import { webhookLogs, purchases } from "@netrabox/core/schemas";
import { initPgliteDatabase } from "@netrabox/core/db";
import { buildServer } from "../src/server.js";
import { DrizzleStateStore } from "../src/services/state-machine/drizzle-store.js";
import { AuthExpiryMonitorJob } from "../src/services/jobs/auth-expiry.js";
import { SettlementService } from "../src/services/settlement/service.js";
import { PolicyEngine } from "@netrabox/core";
import { PayPalClient } from "../src/services/paypal/client.js";
import { EvidenceService } from "../src/services/evidence/service.js";

describe("PostgreSQL State Persistence & Concurrency Guards", () => {
  const { privateKeyHex, publicKeyHex } = generateEd25519Keypair();

  describe("1. Restart-Survival (Dispute & Tribunal Transcript)", () => {
    it("creates a dispute, restarts the app, and reads it back from PostgreSQL with disputePhase intact", async () => {
      const dataDir = resolve(tmpdir(), `netrabox-restart-test-${randomUUID()}`);

      try {
        // --- PHASE 1: First Application Lifetime ---
        const db1 = initPgliteDatabase(dataDir);
        const store1 = new DrizzleStateStore(db1);
        const evidenceService1 = new EvidenceService(store1, privateKeyHex, publicKeyHex);

        const purchaseId = `pur_restart_${randomUUID()}`;
        // Create initial purchase in CAPTURED state
        await db1.insert(purchases).values({
          id: purchaseId,
          buyerId: "usr_alice",
          agentId: "agent_shopping_01",
          merchantId: "merch_gadget_hub",
          title: "Sony Headphones",
          state: "CAPTURED",
          currency: "USD",
          amountMinor: 34999,
          capturedAmountMinor: 34999,
          refundedAmountMinor: 0,
          paypalOrderId: "order_123",
          paypalCaptureId: "cap_123",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Append cryptographically valid genesis instruction
        await evidenceService1.appendEvent({
          purchaseId,
          type: "INSTRUCTION_RECEIVED",
          actor: "user",
          payload: { prompt: "Buy brand new Sony headphones" },
        });

        const app1 = buildServer({
          store: store1,
          evidenceService: evidenceService1,
          signingPrivateKeyHex: privateKeyHex,
          signingPublicKeyHex: publicKeyHex,
          isTest: true,
          demoMode: true,
        });

        // Open dispute in app 1
        const postRes = await app1.inject({
          method: "POST",
          url: "/api/v1/disputes",
          payload: {
            purchaseId,
            reason: "Merchant shipped refurbished unit instead of new",
            claimantActor: "user",
            disputedAmountMinor: 34999,
          },
        });

        expect(postRes.statusCode).toBe(201);
        const postData = JSON.parse(postRes.payload);
        const disputeId = postData.dispute.id;
        expect(disputeId).toBeDefined();
        expect(postData.dispute.disputePhase).toBeDefined();

        // Close app 1 and flush database connection
        await app1.close();
        const client1 = (db1 as unknown as { pgClient?: { close(): Promise<void> } }).pgClient;
        if (client1) {
          await client1.close();
        }

        // --- PHASE 2: Application Restart (Fresh Server, Fresh Store, Same Postgres Storage) ---
        const db2 = initPgliteDatabase(dataDir);
        const store2 = new DrizzleStateStore(db2);
        const evidenceService2 = new EvidenceService(store2, privateKeyHex, publicKeyHex);

        const app2 = buildServer({
          store: store2,
          evidenceService: evidenceService2,
          signingPrivateKeyHex: privateKeyHex,
          signingPublicKeyHex: publicKeyHex,
          isTest: true,
          demoMode: true,
        });

        // Read back dispute from app 2
        const getRes = await app2.inject({
          method: "GET",
          url: `/api/v1/disputes/${disputeId}`,
        });

        expect(getRes.statusCode).toBe(200);
        const getData = JSON.parse(getRes.payload);

        // Verify dispute survived restart completely
        expect(getData.dispute).toBeDefined();
        expect(getData.dispute.id).toBe(disputeId);
        expect(getData.dispute.purchaseId).toBe(purchaseId);
        expect(getData.dispute.reason).toBe("Merchant shipped refurbished unit instead of new");
        expect(getData.dispute.disputePhase).toBeDefined();
        // Check that disputePhase is a valid phase
        expect([
          "TRIAGE",
          "EVIDENCE_LOCKED",
          "TRIBUNAL_ACTIVE",
          "POLICY_VALIDATION",
          "NEEDS_HUMAN_REVIEW",
          "RESOLVED",
        ]).toContain(getData.dispute.disputePhase);

        // Verify tribunal run record also survived restart
        expect(getData.tribunalRun).toBeDefined();
        expect(getData.tribunalRun.disputeId).toBe(disputeId);
        expect(getData.tribunalRun.purchaseId).toBe(purchaseId);

        await app2.close();
        const client2 = (db2 as unknown as { pgClient?: { close(): Promise<void> } }).pgClient;
        if (client2) {
          await client2.close();
        }
      } finally {
        if (existsSync(dataDir)) {
          rmSync(dataDir, { recursive: true, force: true });
        }
      }
    }, 20000);
  });

  describe("2. Webhook Deduplication (ON CONFLICT DO NOTHING)", () => {
    it("processes duplicate webhook delivery exactly once and skips reprocessing", async () => {
      const db = initPgliteDatabase();
      const store = new DrizzleStateStore(db);

      const mockPayPalClient = new PayPalClient({
        clientId: "mock_id",
        clientSecret: "mock_secret",
      });

      // Mock signature verification to return true
      vi.spyOn(mockPayPalClient, "verifyWebhookSignature").mockResolvedValue(true);

      const app = buildServer({
        store,
        paypalClient: mockPayPalClient,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        isTest: true,
      });

      const eventId = `WH-EVT-DEDUP-${randomUUID()}`;
      const webhookPayload = {
        id: eventId,
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        summary: "Payment capture completed for testing",
        resource: {
          id: "cap_999",
          amount: { value: "50.00", currency_code: "USD" },
        },
      };

      const webhookHeaders = {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/certs/cert.pem",
        "paypal-transmission-id": "trans_123",
        "paypal-transmission-sig": "sig_xyz",
        "paypal-transmission-time": new Date().toISOString(),
      };

      // 1st delivery: successfully processed
      const res1 = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/paypal",
        headers: webhookHeaders,
        payload: webhookPayload,
      });

      expect(res1.statusCode).toBe(200);
      const data1 = JSON.parse(res1.payload);
      expect(data1.status).toBe("processed");
      expect(data1.eventId).toBe(eventId);

      // Verify row exists in webhook_logs
      const logsAfter1 = await db
        .select()
        .from(webhookLogs)
        .where(eq(webhookLogs.eventId, eventId));
      expect(logsAfter1.length).toBe(1);
      expect(logsAfter1[0].processed).toBe(true);

      // 2nd delivery (identical duplicate): returns 200 ignored_duplicate without reprocessing
      const res2 = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/paypal",
        headers: webhookHeaders,
        payload: webhookPayload,
      });

      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.payload);
      expect(data2.status).toBe("ignored_duplicate");
      expect(data2.eventId).toBe(eventId);

      // Verify still exactly 1 log record in table
      const logsAfter2 = await db
        .select()
        .from(webhookLogs)
        .where(eq(webhookLogs.eventId, eventId));
      expect(logsAfter2.length).toBe(1);

      await app.close();
    });
  });

  describe("3. AuthExpiryMonitorJob Concurrency Guard", () => {
    it("ensures the job runs once at a time, skipping overlapping executions", async () => {
      const db = initPgliteDatabase();
      const store = new DrizzleStateStore(db);
      const policyEngine = new PolicyEngine();
      const paypalClient = new PayPalClient({
        clientId: "mock_id",
        clientSecret: "mock_secret",
      });
      const settlementService = new SettlementService(
        store,
        paypalClient,
        policyEngine,
        privateKeyHex,
      );

      const job = new AuthExpiryMonitorJob(settlementService);

      // Mock scanAuthorizations to simulate an async delay
      let resolveSlowScan: (val: unknown) => void;
      const slowScanPromise = new Promise((resolve) => {
        resolveSlowScan = resolve;
      });

      vi.spyOn(job, "scanAuthorizations").mockImplementation(async () => {
        await slowScanPromise;
        return {
          scannedCount: 1,
          flaggedCount: 0,
          voidedCount: 0,
          flaggedPurchaseIds: [],
          voidedPurchaseIds: [],
        };
      });

      // Call 1: Starts slow scan
      const run1Promise = job.runScan(store);

      // Call 2: Triggered immediately while Run 1 is in-flight
      const run2Result = await job.runScan(store);

      // Guard check: Run 2 must be skipped due to isRunning guard
      expect(run2Result.status).toBe("skipped_in_progress");

      // Now complete Run 1
      resolveSlowScan!({
        scannedCount: 1,
        flaggedCount: 0,
        voidedCount: 0,
        flaggedPurchaseIds: [],
        voidedPurchaseIds: [],
      });

      const run1Result = await run1Promise;
      expect(run1Result.status).toBe("ok");
      expect(run1Result.result?.scannedCount).toBe(1);

      // Call 3: After Run 1 completes, job can run again cleanly
      vi.spyOn(job, "scanAuthorizations").mockResolvedValue({
        scannedCount: 2,
        flaggedCount: 0,
        voidedCount: 0,
        flaggedPurchaseIds: [],
        voidedPurchaseIds: [],
      });

      const run3Result = await job.runScan(store);
      expect(run3Result.status).toBe("ok");
      expect(run3Result.result?.scannedCount).toBe(2);
    });

    it("exposes POST /jobs/auth-expiry for demo mode", async () => {
      const db = initPgliteDatabase();
      const store = new DrizzleStateStore(db);

      const app = buildServer({
        store,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        isTest: true,
        demoMode: true,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/jobs/auth-expiry",
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.status).toBe("ok");
      expect(data.result).toBeDefined();
      expect(data.result.scannedCount).toBe(0);

      await app.close();
    });
  });

  describe("4. Dispute Phases Progress & Evidence Logging", () => {
    it("progresses disputePhase through tribunal lifecycle and appends TRIBUNAL_STEP evidence", async () => {
      const db = initPgliteDatabase();
      const store = new DrizzleStateStore(db);
      const evidenceService = new EvidenceService(store, privateKeyHex, publicKeyHex);

      const purchaseId = `pur_phases_${randomUUID()}`;
      await db.insert(purchases).values({
        id: purchaseId,
        buyerId: "usr_bob",
        agentId: "agent_01",
        merchantId: "merch_01",
        title: "Sony XM5",
        state: "CAPTURED",
        currency: "USD",
        amountMinor: 35000,
        capturedAmountMinor: 35000,
        refundedAmountMinor: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Append valid signed genesis evidence
      await evidenceService.appendEvent({
        purchaseId,
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Buy brand new Sony XM5" },
      });

      const app = buildServer({
        store,
        evidenceService,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        isTest: true,
        demoMode: true,
      });

      const postRes = await app.inject({
        method: "POST",
        url: "/api/v1/disputes",
        payload: {
          purchaseId,
          reason: "Wrong item delivered",
          claimantActor: "user",
          disputedAmountMinor: 35000,
        },
      });

      expect(postRes.statusCode).toBe(201);
      const postData = JSON.parse(postRes.payload);
      expect(postData.dispute.disputePhase).toBeDefined();

      // Check evidence events for TRIBUNAL_STEP phase transitions
      const eventsRes = await app.inject({
        method: "GET",
        url: `/api/v1/purchases/${purchaseId}/evidence`,
      });
      expect(eventsRes.statusCode).toBe(200);
      const { events } = JSON.parse(eventsRes.payload);

      const phaseEvents = events.filter(
        (e: EvidenceEvent) =>
          e.type === "TRIBUNAL_STEP" &&
          (e.payload as Record<string, unknown>)?.step === "DISPUTE_PHASE_CHANGED",
      );
      expect(phaseEvents.length).toBeGreaterThanOrEqual(1);

      const recordedPhases = phaseEvents.map(
        (e: EvidenceEvent) => (e.payload as Record<string, unknown>).phase,
      );
      expect(recordedPhases).toContain("EVIDENCE_LOCKED");
      expect(recordedPhases).toContain("TRIBUNAL_ACTIVE");
      expect(recordedPhases).toContain("POLICY_VALIDATION");

      await app.close();
    });
  });
});
