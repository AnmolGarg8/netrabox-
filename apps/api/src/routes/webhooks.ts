import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { webhookLogs } from "@netrabox/core/schemas";
import { db as defaultDb, type DbType } from "@netrabox/core/db";
import type { PayPalClient } from "../services/paypal/client.js";
import type { PurchaseStateMachineService } from "../services/state-machine/machine.js";

export interface WebhookRouteOptions {
  paypalClient: PayPalClient;
  stateMachine: PurchaseStateMachineService;
  signingPrivateKeyHex: string;
  db?: DbType;
  findPurchaseByPayPalId?: (paypalId: string) => Promise<string | null>;
}

export const webhookRoutes: FastifyPluginAsync<WebhookRouteOptions> = async (fastify, opts) => {
  const { paypalClient, stateMachine, signingPrivateKeyHex } = opts;
  const db = opts.db || defaultDb;

  fastify.post("/webhooks/paypal", async (request, reply) => {
    const headers = request.headers;
    const body = request.body as Record<string, unknown>;

    const authAlgo = headers["paypal-auth-algo"] as string;
    const certUrl = headers["paypal-cert-url"] as string;
    const transmissionId = headers["paypal-transmission-id"] as string;
    const transmissionSig = headers["paypal-transmission-sig"] as string;
    const transmissionTime = headers["paypal-transmission-time"] as string;

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      return reply.status(400).send({
        error: "Missing required PayPal signature verification headers",
      });
    }

    const eventId = body?.id as string;
    const eventType = body?.event_type as string;
    const resource = (body?.resource || {}) as Record<string, unknown>;

    if (!eventId || !eventType) {
      return reply.status(400).send({ error: "Malformed webhook payload" });
    }

    // 1. Idempotency via database: insert with ON CONFLICT DO NOTHING
    const inserted = await db
      .insert(webhookLogs)
      .values({
        id: `wb_${randomUUID()}`,
        eventId,
        eventType,
        summary: (body?.summary as string) || `Webhook event: ${eventType}`,
        rawPayload: body,
        verified: false,
        processed: false,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: webhookLogs.eventId })
      .returning();

    // If nothing was inserted, it is a duplicate event
    if (!inserted || inserted.length === 0) {
      return reply.status(200).send({
        status: "ignored_duplicate",
        eventId,
      });
    }

    const logRecord = inserted[0];

    // 2. Verify signature with PayPal API
    const isVerified = await paypalClient.verifyWebhookSignature({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      webhookEvent: body,
    });

    if (!isVerified) {
      return reply.status(400).send({
        error: "PayPal webhook signature verification failed",
      });
    }

    await db.update(webhookLogs).set({ verified: true }).where(eq(webhookLogs.id, logRecord.id));

    // 3. Map event to state machine transitions
    // Attempt to extract purchaseId from custom_id, invoice_id, or purchase unit reference_id
    let purchaseId: string | undefined =
      (resource.custom_id as string) || (resource.invoice_id as string);

    if (!purchaseId && Array.isArray(resource.purchase_units)) {
      const refId = resource.purchase_units[0]?.reference_id as string;
      if (refId?.startsWith("purchase_")) {
        purchaseId = refId.replace("purchase_", "");
      }
    }

    // Fallback: lookup by order/authorization ID if lookup function provided
    if (!purchaseId && opts.findPurchaseByPayPalId) {
      const supplementary = resource.supplementary_data as Record<string, unknown> | undefined;
      const relatedIds = supplementary?.related_ids as Record<string, string> | undefined;
      const lookupId = (resource.id as string) || relatedIds?.order_id;
      if (lookupId) {
        const found = await opts.findPurchaseByPayPalId(lookupId);
        if (found) purchaseId = found;
      }
    }

    if (purchaseId) {
      try {
        switch (eventType) {
          case "PAYMENT.AUTHORIZATION.CREATED":
            await stateMachine.transition({
              purchaseId,
              action: "APPROVE_AND_AUTHORIZE",
              actor: "paypal",
              payload: { eventType, webhookEventId: eventId, resource },
              signingPrivateKeyHex,
              patch: { paypalAuthorizationId: resource.id as string },
            });
            break;

          case "PAYMENT.AUTHORIZATION.VOIDED":
            await stateMachine.transition({
              purchaseId,
              action: "VOID_ORDER",
              actor: "paypal",
              payload: { eventType, webhookEventId: eventId, resource },
              signingPrivateKeyHex,
            });
            break;

          case "PAYMENT.CAPTURE.COMPLETED":
            await stateMachine.transition({
              purchaseId,
              action: "CAPTURE_PAYMENT",
              actor: "paypal",
              payload: { eventType, webhookEventId: eventId, resource },
              signingPrivateKeyHex,
              patch: { paypalCaptureId: resource.id as string },
            });
            break;

          case "PAYMENT.CAPTURE.REFUNDED":
            await stateMachine.transition({
              purchaseId,
              action: "RESOLVE_REFUND_FULL",
              actor: "paypal",
              payload: { eventType, webhookEventId: eventId, resource },
              signingPrivateKeyHex,
            });
            break;

          case "CUSTOMER.DISPUTE.CREATED":
            await stateMachine.transition({
              purchaseId,
              action: "OPEN_DISPUTE",
              actor: "paypal",
              payload: { eventType, webhookEventId: eventId, resource },
              signingPrivateKeyHex,
            });
            break;

          default:
            // Unmapped events are logged but do not trigger state changes
            break;
        }
      } catch (transitionErr) {
        request.log.warn(
          `Webhook event ${eventType} could not transition purchase ${purchaseId}: ${
            transitionErr instanceof Error ? transitionErr.message : String(transitionErr)
          }`,
        );
      }
    }

    await db.update(webhookLogs).set({ processed: true }).where(eq(webhookLogs.id, logRecord.id));

    return reply.status(200).send({
      status: "processed",
      eventId,
      eventType,
      purchaseId: purchaseId || null,
    });
  });
};
