import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { CreatePurchaseSchema, ProposedCartSchema } from "@netrabox/core";
import type { PayPalClient } from "../services/paypal/client.js";
import type { PurchaseStateMachineService } from "../services/state-machine/machine.js";
import type { IStateStore } from "../services/state-machine/machine.js";

export interface PurchaseRouteOptions {
  paypalClient: PayPalClient;
  stateMachine: PurchaseStateMachineService;
  store: IStateStore;
  signingPrivateKeyHex: string;
  publicBaseUrl: string;
  dashboardUrl: string;
}

export const purchaseRoutes: FastifyPluginAsync<PurchaseRouteOptions> = async (fastify, opts) => {
  const { paypalClient, stateMachine, store, signingPrivateKeyHex, publicBaseUrl, dashboardUrl } =
    opts;

  /**
   * Initialize a new purchase in DRAFT
   */
  fastify.post("/purchases", async (request, reply) => {
    const parseResult = CreatePurchaseSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: "Invalid purchase input", details: parseResult.error.format() });
    }

    const input = parseResult.data;
    const purchaseId = `pur_${randomUUID()}`;

    const newPurchase = await store.applyAtomicTransition(
      purchaseId,
      "DRAFT",
      {
        id: purchaseId,
        buyerId: input.buyerId,
        agentId: input.agentId,
        merchantId: input.merchantId,
        title: input.title,
        state: "DRAFT",
        currency: input.currency,
        amountMinor: input.amountMinor,
        capturedAmountMinor: 0,
        refundedAmountMinor: 0,
        metadata: input.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: `ev_${randomUUID()}`,
        purchaseId,
        seq: 1,
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { title: input.title, metadata: input.metadata, amountMinor: input.amountMinor },
        createdAt: new Date().toISOString(),
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
        hash: "dummy_initial_hash",
        signature: "dummy_initial_sig",
        signerKeyId: "netrabox_system_key",
      },
    );

    return reply.status(201).send(newPurchase);
  });

  /**
   * Get purchase details
   */
  fastify.get("/purchases/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purchase = await store.getPurchase(id);
    if (!purchase) {
      return reply.status(404).send({ error: "Purchase not found" });
    }
    return reply.send(purchase);
  });

  /**
   * Intent check pass/fail
   */
  fastify.post("/purchases/:id/intent-check", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body =
      (request.body as {
        passed?: boolean;
        score?: number;
        constraints?: Record<string, unknown>;
      }) || {};
    const passed = body.passed !== false;

    const action = passed ? "PASS_INTENT_CHECK" : "FAIL_INTENT_CHECK";
    const result = await stateMachine.transition({
      purchaseId: id,
      action,
      actor: "agent",
      payload: { score: body.score || 0.95, constraints: body.constraints || {} },
      signingPrivateKeyHex,
      patch: { intentCheckPassed: passed },
    });

    return reply.send({
      purchase: result.purchase,
      intentCheckPassed: passed,
    });
  });

  /**
   * Agent proposes cart -> transitions to AWAITING_BUYER_APPROVAL
   */
  fastify.post("/purchases/:id/cart", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parseResult = ProposedCartSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .status(400)
        .send({ error: "Invalid cart payload", details: parseResult.error.format() });
    }

    const cart = parseResult.data;
    const result = await stateMachine.transition({
      purchaseId: id,
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { cart },
      signingPrivateKeyHex,
    });

    return reply.send(result);
  });

  /**
   * Create PayPal Order with intent AUTHORIZE & return approval URL
   */
  fastify.post("/purchases/:id/authorize", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purchase = await store.getPurchase(id);
    if (!purchase) {
      return reply.status(404).send({ error: "Purchase not found" });
    }

    const returnUrl = `${publicBaseUrl}/api/v1/purchases/${id}/return`;
    const cancelUrl = `${publicBaseUrl}/api/v1/purchases/${id}/cancel`;

    const { order, approvalUrl } = await paypalClient.createOrder({
      purchaseId: id,
      amountMinor: purchase.amountMinor,
      currency: purchase.currency,
      returnUrl,
      cancelUrl,
      description: `NetraBox Purchase: ${purchase.title}`,
    });

    // Update purchase record with paypalOrderId
    await store.applyAtomicTransition(
      id,
      purchase.state,
      { paypalOrderId: order.id },
      {
        id: `ev_${randomUUID()}`,
        purchaseId: id,
        seq: 999, // placeholder for order creation event
        type: "PAYPAL_ORDER_CREATED",
        actor: "system",
        payload: { paypalOrderId: order.id, approvalUrl },
        createdAt: new Date().toISOString(),
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
        hash: "order_created_hash",
        signature: "order_created_sig",
        signerKeyId: "netrabox_system_key",
      },
    );

    return reply.send({
      paypalOrderId: order.id,
      approvalUrl,
    });
  });

  /**
   * Handle buyer return from PayPal approval flow -> executes PayPal authorizeOrder
   */
  fastify.get("/purchases/:id/return", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string; PayerID?: string };

    const purchase = await store.getPurchase(id);
    if (!purchase) {
      return reply.status(404).send({ error: "Purchase not found" });
    }

    const orderId = query.token || purchase.paypalOrderId;
    if (!orderId) {
      return reply.status(400).send({ error: "Missing PayPal order token" });
    }

    // Call PayPal Authorize API
    const { authorizationId, authorizationResponse } = await paypalClient.authorizeOrder(
      orderId,
      id,
    );

    // Atomically transition state to AUTHORIZED with evidence event
    const result = await stateMachine.transition({
      purchaseId: id,
      action: "APPROVE_AND_AUTHORIZE",
      actor: "user",
      payload: {
        paypalOrderId: orderId,
        payerId: query.PayerID,
        authorizationId,
        authorizationResponse,
      },
      signingPrivateKeyHex,
      patch: {
        paypalOrderId: orderId,
        paypalAuthorizationId: authorizationId,
      },
    });

    // Redirect to dashboard or return JSON
    if (request.headers.accept?.includes("text/html")) {
      return reply.redirect(`${dashboardUrl}/purchases/${id}?authorized=true`);
    }

    return reply.send(result);
  });

  /**
   * Handle buyer cancel from PayPal approval flow
   */
  fastify.get("/purchases/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await stateMachine.transition({
      purchaseId: id,
      action: "REJECT_APPROVAL",
      actor: "user",
      payload: { reason: "User cancelled in PayPal checkout window" },
      signingPrivateKeyHex,
    });

    if (request.headers.accept?.includes("text/html")) {
      return reply.redirect(`${dashboardUrl}/purchases/${id}?cancelled=true`);
    }

    return reply.send(result);
  });

  /**
   * Record delivery fulfillment
   */
  fastify.post("/purchases/:id/delivery", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { trackingNumber?: string; carrier?: string }) || {};

    const result = await stateMachine.transition({
      purchaseId: id,
      action: "RECORD_DELIVERY",
      actor: "merchant",
      payload: { delivery: body },
      signingPrivateKeyHex,
    });

    return reply.send(result);
  });

  /**
   * Capture authorization (Full or Partial)
   */
  fastify.post("/purchases/:id/capture", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { amountMinor?: number; finalCapture?: boolean }) || {};

    const purchase = await store.getPurchase(id);
    if (!purchase || !purchase.paypalAuthorizationId) {
      return reply
        .status(400)
        .send({ error: "Purchase is not authorized or missing paypalAuthorizationId" });
    }

    const isPartial = body.amountMinor !== undefined && body.amountMinor < purchase.amountMinor;
    const captureAmountMinor = body.amountMinor ?? purchase.amountMinor;

    const captureResult = await paypalClient.captureAuthorization(
      purchase.paypalAuthorizationId,
      id,
      {
        amountMinor: isPartial ? captureAmountMinor : undefined,
        currency: purchase.currency,
        finalCapture: body.finalCapture ?? true,
      },
    );

    const action = isPartial ? "CAPTURE_PARTIAL" : "CAPTURE_PAYMENT";
    const result = await stateMachine.transition({
      purchaseId: id,
      action,
      actor: "system",
      payload: { captureResponse: captureResult, isPartial, amountMinor: captureAmountMinor },
      signingPrivateKeyHex,
      patch: {
        capturedAmountMinor: captureAmountMinor,
        paypalCaptureId: captureResult.id,
      },
    });

    return reply.send(result);
  });

  /**
   * Void authorization
   */
  fastify.post("/purchases/:id/void", async (request, reply) => {
    const { id } = request.params as { id: string };
    const purchase = await store.getPurchase(id);
    if (!purchase || !purchase.paypalAuthorizationId) {
      return reply
        .status(400)
        .send({ error: "Purchase is not authorized or missing paypalAuthorizationId" });
    }

    const voidResponse = await paypalClient.voidAuthorization(purchase.paypalAuthorizationId, id);

    const result = await stateMachine.transition({
      purchaseId: id,
      action: "VOID_ORDER",
      actor: "system",
      payload: { voidResponse },
      signingPrivateKeyHex,
    });

    return reply.send(result);
  });

  /**
   * Refund capture (Full or Partial)
   */
  fastify.post("/purchases/:id/refund", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { amountMinor?: number; note?: string }) || {};

    const purchase = await store.getPurchase(id);
    if (!purchase || !purchase.paypalCaptureId) {
      return reply.status(400).send({ error: "Purchase has no captured payment to refund" });
    }

    const refundAmountMinor = body.amountMinor ?? purchase.capturedAmountMinor;
    const isPartial = refundAmountMinor < purchase.capturedAmountMinor;

    const refundResponse = await paypalClient.refundCapture(purchase.paypalCaptureId, id, {
      amountMinor: isPartial ? refundAmountMinor : undefined,
      currency: purchase.currency,
      note: body.note,
    });

    const action = isPartial ? "RESOLVE_REFUND_PARTIAL" : "RESOLVE_REFUND_FULL";
    const result = await stateMachine.transition({
      purchaseId: id,
      action,
      actor: "system",
      payload: { refundResponse, isPartial, refundAmountMinor },
      signingPrivateKeyHex,
      patch: {
        refundedAmountMinor: (purchase.refundedAmountMinor || 0) + refundAmountMinor,
      },
    });

    return reply.send(result);
  });
};
