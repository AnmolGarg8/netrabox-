import { z } from "zod";

export const EvidenceActorSchema = z.enum([
  "user",
  "agent",
  "merchant",
  "system",
  "paypal",
  "tribunal",
]);

export type EvidenceActor = z.infer<typeof EvidenceActorSchema>;

export const EvidenceEventTypeSchema = z.enum([
  "INSTRUCTION_RECEIVED",
  "CONSTRAINTS_EXTRACTED",
  "OFFERS_OBSERVED",
  "AGENT_REASONING",
  "CART_PROPOSED",
  "INTENT_CHECK_RESULT",
  "USER_APPROVAL",
  "PAYPAL_ORDER_CREATED",
  "PAYPAL_AUTHORIZED",
  "DELIVERY_EVENT",
  "PAYPAL_CAPTURED",
  "PAYPAL_VOIDED",
  "PAYPAL_REFUNDED",
  "DISPUTE_OPENED",
  "TRIBUNAL_STEP",
  "TRIBUNAL_VERDICT",
  "ACTION_EXECUTED",
  "SETTLEMENT_REQUESTED",
  "SETTLEMENT_FAILED",
]);

export type EvidenceEventType = z.infer<typeof EvidenceEventTypeSchema>;

export const EvidenceEventBodySchema = z.object({
  id: z.string().min(1),
  purchaseId: z.string().min(1),
  seq: z.number().int().positive(),
  type: EvidenceEventTypeSchema,
  actor: EvidenceActorSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime().or(z.date()),
  prevHash: z.string().length(64),
  signerKeyId: z.string().min(1),
});

export type EvidenceEventBody = z.infer<typeof EvidenceEventBodySchema>;

export const EvidenceEventSchema = EvidenceEventBodySchema.extend({
  hash: z.string().length(64),
  signature: z.string().min(1),
});

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const AppendEvidenceInputSchema = z.object({
  type: EvidenceEventTypeSchema,
  actor: EvidenceActorSchema,
  payload: z.record(z.string(), z.unknown()),
  signerKeyId: z.string().default("system_key"),
});

export type AppendEvidenceInput = z.infer<typeof AppendEvidenceInputSchema>;

export const EvidenceVerificationResultSchema = z.object({
  valid: z.boolean(),
  totalEvents: z.number().int().nonnegative(),
  lastHash: z.string().optional(),
  brokenSeq: z.number().int().optional(),
  error: z.string().optional(),
});

export type EvidenceVerificationResult = z.infer<typeof EvidenceVerificationResultSchema>;
