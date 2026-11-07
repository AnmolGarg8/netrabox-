import { z } from "zod";

export const SettlementActionKindSchema = z.enum([
  "CAPTURE",
  "PARTIAL_CAPTURE",
  "VOID",
  "REFUND_FULL",
  "REFUND_PARTIAL",
]);
export type SettlementActionKind = z.infer<typeof SettlementActionKindSchema>;

export const SettlementActionStatusSchema = z.enum([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "NEEDS_RECONCILE",
]);
export type SettlementActionStatus = z.infer<typeof SettlementActionStatusSchema>;

export const SettlementRequestedBySchema = z.enum(["policy", "human", "job", "merchant"]);
export type SettlementRequestedBy = z.infer<typeof SettlementRequestedBySchema>;

export const SettlementActionRecordSchema = z.object({
  id: z.string().min(1),
  purchaseId: z.string().min(1),
  disputeId: z.string().nullable().optional(),
  kind: SettlementActionKindSchema,
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
  idempotencyKey: z.string().min(1),
  status: SettlementActionStatusSchema.default("PENDING"),
  requestedBy: SettlementRequestedBySchema,
  verdictId: z.string().nullable().optional(),
  reviewerId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  paypalCaptureId: z.string().nullable().optional(),
  paypalRefundId: z.string().nullable().optional(),
  paypalAuthorizationId: z.string().nullable().optional(),
  paypalDebugId: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});
export type SettlementActionRecord = z.infer<typeof SettlementActionRecordSchema>;

/**
 * Computes a deterministic idempotency key for settlement operations.
 * Format: set_<purchaseId>_<kind>_<amountMinor>_<sequence>
 */
export function generateSettlementIdempotencyKey(
  purchaseId: string,
  kind: SettlementActionKind,
  amountMinor: number,
  sequence = 1,
): string {
  const kindNormalized = kind.toLowerCase().replace(/_/g, "-");
  return `set_${purchaseId}_${kindNormalized}_${amountMinor}_seq${sequence}`;
}
