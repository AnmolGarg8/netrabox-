import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { OpenDisputeInputSchema, type EvidenceActor } from "@netrabox/core";
import type { TribunalRunner } from "../services/tribunal/runner.js";
import type { DisputeRecord, TribunalRunRecord } from "../services/tribunal/types.js";
import type { PurchaseStateMachineService } from "../services/state-machine/machine.js";

export interface DisputeRouteOptions {
  tribunalRunner: TribunalRunner;
  stateMachine: PurchaseStateMachineService;
  signingPrivateKeyHex: string;
  disputesMap?: Map<string, DisputeRecord>;
  tribunalRunsMap?: Map<string, TribunalRunRecord>;
}

export const disputeRoutes: FastifyPluginAsync<DisputeRouteOptions> = async (fastify, opts) => {
  const { tribunalRunner, stateMachine, signingPrivateKeyHex } = opts;
  const disputes = opts.disputesMap || new Map<string, DisputeRecord>();
  const tribunalRuns = opts.tribunalRunsMap || new Map<string, TribunalRunRecord>();

  /**
   * 1. POST /disputes
   * Opens a dispute, sets state to DISPUTED, and launches the autonomous tribunal
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
      disputedAmountMinor: input.disputedAmountMinor,
      claimantActor: input.claimantActor,
      createdAt: new Date(),
    };
    disputes.set(disputeId, dispute);

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

    // Launch Autonomous Tribunal asynchronously / synchronously
    const outcome = await tribunalRunner.runTribunal(dispute, disputes, tribunalRuns);

    return reply.status(201).send({
      dispute: outcome.dispute,
      tribunalRun: outcome.tribunalRun,
      verdict: outcome.verdict,
      executedAction: outcome.executedAction,
      requiresHumanReview: outcome.requiresHumanReview,
    });
  });

  /**
   * 2. GET /disputes/:id
   * Retrieves dispute record and tribunal transcript
   */
  fastify.get("/disputes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const dispute = disputes.get(id);
    if (!dispute) {
      return reply.status(404).send({ error: "Dispute not found" });
    }

    const run = Array.from(tribunalRuns.values()).find((r) => r.disputeId === id);

    return reply.send({
      dispute,
      tribunalRun: run || null,
    });
  });

  /**
   * 3. GET /disputes/human-review
   * Lists all disputes requiring human review / escalation
   */
  fastify.get("/disputes/human-review", async (_request, reply) => {
    const list = Array.from(disputes.values()).filter((d) => d.status === "NEEDS_HUMAN_REVIEW");

    return reply.send({
      count: list.length,
      cases: list,
    });
  });

  /**
   * 4. POST /disputes/:id/human-review
   * Human judge overrides or approves the verdict
   */
  fastify.post("/disputes/:id/human-review", async (request, reply) => {
    const { id } = request.params as { id: string };
    const dispute = disputes.get(id);
    if (!dispute) {
      return reply.status(404).send({ error: "Dispute not found" });
    }

    const body = request.body as {
      overrideAction:
        | "RESOLVE_REFUND_FULL"
        | "RESOLVE_REFUND_PARTIAL"
        | "RESOLVE_VOID"
        | "RESOLVE_CAPTURE"
        | "RESOLVE_REJECT";
      humanNotes: string;
      refundAmountMinor?: number;
    };

    if (!body?.overrideAction || !body.humanNotes) {
      return reply.status(400).send({
        error: "Missing required fields: overrideAction, humanNotes",
      });
    }

    // Execute state transition
    await stateMachine.transition({
      purchaseId: dispute.purchaseId,
      action: body.overrideAction,
      actor: "system",
      payload: {
        humanOverride: true,
        humanNotes: body.humanNotes,
        disputeId: id,
      },
      signingPrivateKeyHex,
      patch: body.refundAmountMinor ? { refundedAmountMinor: body.refundAmountMinor } : undefined,
    });

    dispute.status = "RESOLVED";
    dispute.resolutionState = body.overrideAction;
    dispute.resolvedAt = new Date();
    disputes.set(id, dispute);

    return reply.send({
      status: "resolved_by_human",
      dispute,
      overrideAction: body.overrideAction,
    });
  });
};
