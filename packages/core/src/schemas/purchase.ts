import { z } from "zod";

export const PurchaseStateSchema = z.enum([
  "DRAFT",
  "INTENT_CHECKED",
  "AWAITING_BUYER_APPROVAL",
  "AUTHORIZED",
  "DELIVERED",
  "CAPTURED",
  "PARTIALLY_CAPTURED",
  "VOIDED",
  "DISPUTED",
  "RESOLVED_CAPTURED",
  "RESOLVED_VOIDED",
  "RESOLVED_REFUNDED_FULL",
  "RESOLVED_REFUNDED_PARTIAL",
  "RESOLVED_REJECTED",
  "NEEDS_HUMAN_REVIEW",
]);

export type PurchaseState = z.infer<typeof PurchaseStateSchema>;

export const CreatePurchaseSchema = z.object({
  buyerId: z.string().min(1),
  agentId: z.string().min(1),
  merchantId: z.string().min(1),
  title: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>;

export const IntentCheckResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().optional(),
  extractedConstraints: z.record(z.string(), z.unknown()),
});

export type IntentCheckResult = z.infer<typeof IntentCheckResultSchema>;

export const CartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceMinor: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
});

export const ProposedCartSchema = z.object({
  items: z.array(CartItemSchema).min(1),
  merchantQuoteId: z.string().min(1),
  currency: z.string().length(3).optional(),
  subtotalMinor: z.number().int().nonnegative().optional(),
  shippingMinor: z.number().int().nonnegative().optional(),
  taxMinor: z.number().int().nonnegative().optional(),
  totalMinor: z.number().int().positive().optional(),
});

export type ProposedCart = z.infer<typeof ProposedCartSchema>;
