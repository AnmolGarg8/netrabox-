import type { FastifyPluginAsync } from "fastify";
import { AppendEvidenceInputSchema } from "@netrabox/core";
import type { EvidenceService } from "../services/evidence/service.js";

export interface EvidenceRouteOptions {
  evidenceService: EvidenceService;
  demoMode?: boolean;
}

export const evidenceRoutes: FastifyPluginAsync<EvidenceRouteOptions> = async (fastify, opts) => {
  const { evidenceService } = opts;
  const demoMode = opts.demoMode ?? process.env.DEMO_MODE === "true";

  /**
   * GET /purchases/:id/evidence
   * Retrieves chronological list of evidence events
   */
  fastify.get("/purchases/:id/evidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const events = await evidenceService.getEvents(id);
    return reply.send({
      purchaseId: id,
      totalEvents: events.length,
      events,
    });
  });

  /**
   * GET /purchases/:id/evidence/verify
   * Runs the deterministic cryptographic chain verifier
   */
  fastify.get("/purchases/:id/evidence/verify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = await evidenceService.verifyChain(id);
    return reply.send(report);
  });

  /**
   * GET /purchases/:id/evidence-pack
   * Exports portable evidence bundle with Merkle root and public key
   */
  fastify.get("/purchases/:id/evidence-pack", async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await evidenceService.getEvidencePack(id);
    return reply.send(pack);
  });

  /**
   * POST /purchases/:id/evidence
   * Appends an event to the evidence chain (used by agents/SDK)
   */
  fastify.post("/purchases/:id/evidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parseResult = AppendEvidenceInputSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid evidence input payload",
        details: parseResult.error.format(),
      });
    }

    const input = parseResult.data;
    try {
      const event = await evidenceService.appendEvent({
        purchaseId: id,
        type: input.type,
        actor: input.actor,
        payload: input.payload,
        signerKeyId: input.signerKeyId,
      });

      return reply.status(201).send(event);
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * POST /demo/tamper
   * Demo-only tampering endpoint (requires DEMO_MODE=true)
   */
  fastify.post("/demo/tamper", async (request, reply) => {
    if (!demoMode) {
      return reply.status(403).send({
        error: "Forbidden: /demo/tamper is disabled unless DEMO_MODE=true",
      });
    }

    const body = request.body as {
      purchaseId?: string;
      targetSeq?: number;
      tamperedPayload?: Record<string, unknown>;
    };

    if (!body?.purchaseId || typeof body.targetSeq !== "number" || !body.tamperedPayload) {
      return reply.status(400).send({
        error: "Missing required fields: purchaseId, targetSeq, tamperedPayload",
      });
    }

    try {
      const result = await evidenceService.tamperEvent(
        body.purchaseId,
        body.targetSeq,
        body.tamperedPayload,
      );

      return reply.send({
        status: "tampered_silently",
        message: `Event #${body.targetSeq} payload altered. Subsequent verification should fail.`,
        ...result,
      });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
