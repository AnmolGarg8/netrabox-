import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { OpenDisputeInputSchema, type EvidenceActor, type DisputePhase } from "@netrabox/core";
import { purchases, disputes, tribunalRuns } from "@netrabox/core/schemas";
import { db as defaultDb, type DbType } from "@netrabox/core/db";
import type { TribunalRunner } from "../services/tribunal/runner.js";
import type { DisputeRecord } from "../services/tribunal/types.js";
import type {
  PurchaseStateMachineService,
  IStateStore,
} from "../services/state-machine/machine.js";
import type { PurchaseRecord } from "../services/state-machine/types.js";
import type { SettlementService } from "../services/settlement/service.js";

export interface DisputeRouteOptions {
  tribunalRunner: TribunalRunner;
  stateMachine: PurchaseStateMachineService;
  signingPrivateKeyHex: string;
  store?: IStateStore;
  settlementService?: SettlementService;
  db?: DbType;
}

export const disputeRoutes: FastifyPluginAsync<DisputeRouteOptions> = async (fastify, opts) => {
  const { tribunalRunner, stateMachine, signingPrivateKeyHex, store, settlementService } = opts;
  const db = opts.db || (store as any)?.getDb?.() || defaultDb;

  /**
   * 1. POST /disputes
   * Opens a dispute, records in Postgres disputes table, sets state to DISPUTED,
   * and launches the autonomous tribunal
   */
  fastify.post("/disputes", async (request, reply) => {
    const parseResult = OpenDisputeInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid dispute input",
        details: parseResult.error.format(),
      });
    }

    const input = parseResult.data;
    const purchaseId = input.purchaseId || (request.query as { purchaseId?: string }).purchaseId;

    if (!purchaseId) {
      return reply.status(400).send({ error: "Missing purchaseId in body or query" });
    }

    const disputeId = `disp_${randomUUID()}`;
    const dispute: DisputeRecord = {
      id: disputeId,
      purchaseId,
      reason: input.reason,
      status: "OPEN",
      disputePhase: "TRIAGE" as DisputePhase,
      disputedAmountMinor: input.disputedAmountMinor,
      claimantActor: input.claimantActor as EvidenceActor,
      createdAt: new Date(),
    };

    // Ensure parent purchase exists in Postgres for foreign key constraint
    const existingPurchase = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1);

    if (!existingPurchase || existingPurchase.length === 0) {
      if (store) {
        const memPurchase = await store.getPurchase(purchaseId);
        if (memPurchase) {
          await db
            .insert(purchases)
            .values({
              id: memPurchase.id,
              buyerId: memPurchase.buyerId || "usr_unknown",
              agentId: memPurchase.agentId || "agent_unknown",
              merchantId: memPurchase.merchantId || "merch_unknown",
              title: memPurchase.title || "Purchase " + memPurchase.id,
              state: memPurchase.state || "DRAFT",
              currency: memPurchase.currency || "USD",
              amountMinor: memPurchase.amountMinor || 0,
              capturedAmountMinor: memPurchase.capturedAmountMinor || 0,
              refundedAmountMinor: memPurchase.refundedAmountMinor || 0,
              paypalOrderId: memPurchase.paypalOrderId || null,
              paypalAuthorizationId: memPurchase.paypalAuthorizationId || null,
              paypalCaptureId: memPurchase.paypalCaptureId || null,
              intentCheckPassed: memPurchase.intentCheckPassed || false,
              metadata: memPurchase.metadata || {},
              createdAt: new Date(memPurchase.createdAt || Date.now()),
              updatedAt: new Date(memPurchase.updatedAt || Date.now()),
            })
            .onConflictDoNothing();
        }
      }
    }

    // Insert dispute record into Postgres via Drizzle
    await db.insert(disputes).values({
      id: dispute.id,
      purchaseId: dispute.purchaseId,
      reason: dispute.reason,
      status: dispute.status,
      disputePhase: dispute.disputePhase,
      disputedAmountMinor: dispute.disputedAmountMinor,
      claimantActor: dispute.claimantActor,
      createdAt: dispute.createdAt,
    });

    // Enter DISPUTED state in state machine
    try {
      await stateMachine.transition({
        purchaseId,
        action: "OPEN_DISPUTE",
        actor: input.claimantActor as EvidenceActor,
        payload: {
          disputeId,
          reason: input.reason,
          disputedAmountMinor: input.disputedAmountMinor,
        },
        signingPrivateKeyHex,
      });
    } catch (err) {
      return reply.status(400).send({
        error: `Cannot open dispute: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Launch Autonomous Tribunal
    const outcome = await tribunalRunner.runTribunal(dispute);

    // Read back latest dispute state from Postgres to reflect tribunal updates
    const disputeRows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, disputeId))
      .limit(1);

    const disputeToReturn = disputeRows[0] || outcome.dispute;

    return reply.status(201).send({
      dispute: disputeToReturn,
      tribunalRun: outcome.tribunalRun,
      verdict: outcome.verdict,
      executedAction: outcome.executedAction,
      requiresHumanReview: outcome.requiresHumanReview,
    });
  });

  /**
   * 2. GET /disputes/:id
   * Retrieves dispute record and tribunal transcript from Postgres via Drizzle
   */
  fastify.get("/disputes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const disputeRows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, id))
      .limit(1);

    if (!disputeRows || disputeRows.length === 0) {
      return reply.status(404).send({ error: "Dispute not found" });
    }

    const runRows = await db
      .select()
      .from(tribunalRuns)
      .where(eq(tribunalRuns.disputeId, id))
      .orderBy(desc(tribunalRuns.createdAt))
      .limit(1);

    return reply.send({
      dispute: disputeRows[0],
      tribunalRun: runRows[0] || null,
    });
  });

  /**
   * 3. GET /disputes/human-review
   * Lists all disputes requiring human review / escalation from Postgres
   */
  fastify.get("/disputes/human-review", async (_request, reply) => {
    const list = await db
      .select()
      .from(disputes)
      .where(eq(disputes.status, "NEEDS_HUMAN_REVIEW"));

    return reply.send({
      count: list.length,
      cases: list,
    });
  });

  /**
   * 4. POST /disputes/:id/human-review
   * Human judge overrides or approves the verdict; updates Postgres record
   */
  fastify.post("/disputes/:id/human-review", async (request, reply) => {
    const { id } = request.params as { id: string };

    const disputeRows = await db
      .select()
      .from(disputes)
      .where(eq(disputes.id, id))
      .limit(1);

    if (!disputeRows || disputeRows.length === 0) {
      return reply.status(404).send({ error: "Dispute not found" });
    }

    const dispute = disputeRows[0];

    const body = request.body as {
      overrideAction:
        | "RESOLVE_REFUND_FULL"
        | "RESOLVE_REFUND_PARTIAL"
        | "RESOLVE_VOID"
        | "RESOLVE_CAPTURE"
        | "RESOLVE_REJECT";
      humanNotes: string;
      reviewerId?: string;
      refundAmountMinor?: number;
    };

    if (!body?.overrideAction || !body.humanNotes) {
      return reply.status(400).send({
        error: "Missing required fields: overrideAction, humanNotes",
      });
    }

    const reviewerId = body.reviewerId || "human_admin_reviewer";

    // If a financial action, route through SettlementService
    if (
      settlementService &&
      (body.overrideAction === "RESOLVE_REFUND_FULL" ||
        body.overrideAction === "RESOLVE_REFUND_PARTIAL" ||
        body.overrideAction === "RESOLVE_VOID")
    ) {
      let purchase: PurchaseRecord | null = null;
      if (store) {
        purchase = await store.getPurchase(dispute.purchaseId);
      }

      const refundAmount =
        body.overrideAction === "RESOLVE_REFUND_PARTIAL"
          ? (body.refundAmountMinor ?? dispute.disputedAmountMinor)
          : (body.refundAmountMinor ??
            purchase?.capturedAmountMinor ??
            dispute.disputedAmountMinor);

      const kind =
        body.overrideAction === "RESOLVE_REFUND_FULL"
          ? "REFUND_FULL"
          : body.overrideAction === "RESOLVE_REFUND_PARTIAL"
            ? "REFUND_PARTIAL"
            : "VOID";

      await settlementService.execute({
        purchaseId: dispute.purchaseId,
        kind,
        amountMinor: kind === "VOID" ? 0 : refundAmount,
        currency: purchase?.currency || "USD",
        requestedBy: "human",
        reviewerId,
        reason: body.humanNotes,
        disputeId: id,
      });
    } else {
      // Non-monetary state transition (or fallback)
      await stateMachine.transition({
        purchaseId: dispute.purchaseId,
        action: body.overrideAction,
        actor: "system",
        payload: {
          humanOverride: true,
          humanNotes: body.humanNotes,
          reviewerId,
          disputeId: id,
        },
        signingPrivateKeyHex,
        patch: body.refundAmountMinor ? { refundedAmountMinor: body.refundAmountMinor } : undefined,
      });
    }

    const resolvedAt = new Date();
    const updated = await db
      .update(disputes)
      .set({
        status: "RESOLVED",
        disputePhase: "RESOLVED",
        resolutionState: body.overrideAction,
        resolvedAt,
      })
      .where(eq(disputes.id, id))
      .returning();

    return reply.send({
      status: "resolved_by_human",
      dispute: updated[0] || {
        ...dispute,
        status: "RESOLVED",
        disputePhase: "RESOLVED",
        resolutionState: body.overrideAction,
        resolvedAt,
      },
      overrideAction: body.overrideAction,
    });
  });
};
