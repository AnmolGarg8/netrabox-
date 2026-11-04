import { z } from "zod";
import { TribunalVerdictSchema } from "./tribunal.js";

export const InstructionReceivedPayloadSchema = z.object({
  prompt: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).optional(),
  buyerId: z.string().optional(),
});

export const ConstraintsExtractedPayloadSchema = z.object({
  hardConstraints: z.record(z.string(), z.unknown()),
  softPreferences: z.record(z.string(), z.unknown()).optional(),
});

export const OffersObservedPayloadSchema = z.object({
  query: z.string().min(1),
  offers: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        priceMinor: z.number().int().nonnegative(),
        merchantId: z.string().min(1),
        url: z.string().optional(),
        inStock: z.boolean().optional(),
      }),
    )
    .min(1),
});

export const AgentReasoningPayloadSchema = z.object({
  scratchpad: z.string().optional(),
  selectedOfferId: z.string().optional(),
  rationale: z.string().min(1),
});

export const CartProposedPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        priceMinor: z.number().int().nonnegative(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  totalMinor: z.number().int().positive(),
  merchantQuoteId: z.string().min(1),
});

export const IntentCheckResultPayloadSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().optional(),
  extractedConstraints: z.record(z.string(), z.unknown()),
});

export const UserApprovalPayloadSchema = z.object({
  approved: z.boolean(),
  approvedAt: z.string().optional(),
  userNotes: z.string().optional(),
  reason: z.string().optional(),
});

export const PayPalOrderCreatedPayloadSchema = z.object({
  paypalOrderId: z.string().min(1),
  approvalUrl: z.string().url().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
});

export const PayPalAuthorizedPayloadSchema = z.object({
  paypalOrderId: z.string().min(1),
  authorizationId: z.string().min(1),
  payerId: z.string().optional(),
  authorizationResponse: z.record(z.string(), z.unknown()).optional(),
});

export const DeliveryEventPayloadSchema = z.object({
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  deliveredAt: z.string().optional(),
  digitalReceiptUrl: z.string().optional(),
  delivery: z.record(z.string(), z.unknown()).optional(),
});

export const PayPalCapturedPayloadSchema = z.object({
  paypalCaptureId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  finalCapture: z.boolean().default(true),
  captureResponse: z.record(z.string(), z.unknown()).optional(),
  isPartial: z.boolean().optional(),
});

export const PayPalVoidedPayloadSchema = z.object({
  paypalAuthorizationId: z.string().optional(),
  reason: z.string().optional(),
  voidResponse: z.record(z.string(), z.unknown()).optional(),
});

export const PayPalRefundedPayloadSchema = z.object({
  paypalRefundId: z.string().optional(),
  refundAmountMinor: z.number().int().positive().optional(),
  note: z.string().optional(),
  refundResponse: z.record(z.string(), z.unknown()).optional(),
  isPartial: z.boolean().optional(),
});

export const DisputeOpenedPayloadSchema = z.object({
  reason: z.string().min(1),
  claimantActor: z.string().min(1),
  disputedAmountMinor: z.number().int().positive(),
});

export const TribunalStepPayloadSchema = z.object({
  role: z.enum(["buyer_advocate", "merchant_advocate"]),
  argument: z.string().min(1),
  citedEvidenceIds: z.array(z.string()).min(1),
});

export const TribunalVerdictPayloadSchema = TribunalVerdictSchema;

export const ActionExecutedPayloadSchema = z.object({
  action: z.string().min(1),
  executedAt: z.string().optional(),
  transactionId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ToolExecutionPayloadSchema = z.object({
  toolName: z.string().min(1),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
});

export const EventPayloadSchemas = {
  INSTRUCTION_RECEIVED: InstructionReceivedPayloadSchema,
  CONSTRAINTS_EXTRACTED: ConstraintsExtractedPayloadSchema,
  OFFERS_OBSERVED: OffersObservedPayloadSchema,
  AGENT_REASONING: AgentReasoningPayloadSchema,
  CART_PROPOSED: CartProposedPayloadSchema,
  INTENT_CHECK_RESULT: IntentCheckResultPayloadSchema,
  USER_APPROVAL: UserApprovalPayloadSchema,
  PAYPAL_ORDER_CREATED: PayPalOrderCreatedPayloadSchema,
  PAYPAL_AUTHORIZED: PayPalAuthorizedPayloadSchema,
  DELIVERY_EVENT: DeliveryEventPayloadSchema,
  PAYPAL_CAPTURED: PayPalCapturedPayloadSchema,
  PAYPAL_VOIDED: PayPalVoidedPayloadSchema,
  PAYPAL_REFUNDED: PayPalRefundedPayloadSchema,
  DISPUTE_OPENED: DisputeOpenedPayloadSchema,
  TRIBUNAL_STEP: TribunalStepPayloadSchema,
  TRIBUNAL_VERDICT: TribunalVerdictPayloadSchema,
  ACTION_EXECUTED: ActionExecutedPayloadSchema,
} as const;
