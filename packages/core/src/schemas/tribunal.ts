import { z } from "zod";

export const TribunalClassificationSchema = z.enum([
  "AGENT_EXCEEDED_INSTRUCTIONS",
  "INSTRUCTION_AMBIGUOUS",
  "MERCHANT_MISDESCRIBED",
  "DELIVERY_FAILURE",
  "FALSE_CLAIM",
  "NO_FAULT",
]);

export type TribunalClassification = z.infer<typeof TribunalClassificationSchema>;

export const LiabilitySplitSchema = z
  .object({
    buyer: z.number().int().min(0).max(100),
    agentProvider: z.number().int().min(0).max(100),
    merchant: z.number().int().min(0).max(100),
  })
  .refine((split) => split.buyer + split.agentProvider + split.merchant === 100, {
    message: "Liability split percentages must sum exactly to 100",
  });

export type LiabilitySplit = z.infer<typeof LiabilitySplitSchema>;

export const RecommendedActionSchema = z.enum([
  "CAPTURE",
  "PARTIAL_CAPTURE",
  "VOID",
  "REFUND_FULL",
  "REFUND_PARTIAL",
  "REJECT_DISPUTE",
  "ESCALATE_HUMAN",
]);

export type RecommendedAction = z.infer<typeof RecommendedActionSchema>;

export const TribunalVerdictSchema = z.object({
  classification: TribunalClassificationSchema,
  liabilitySplit: LiabilitySplitSchema,
  refundAmountMinor: z.number().int().min(0),
  confidence: z.number().min(0.0).max(1.0),
  citedEvidenceIds: z.array(z.string()).min(1),
  reasoning: z.string().min(20),
  recommendedAction: RecommendedActionSchema,
});

export type TribunalVerdict = z.infer<typeof TribunalVerdictSchema>;

export const OpenDisputeInputSchema = z.object({
  purchaseId: z.string().optional(),
  reason: z.string().min(5),
  claimantActor: z.enum(["user", "agent"]).default("user"),
  disputedAmountMinor: z.number().int().positive(),
});

export type OpenDisputeInput = z.infer<typeof OpenDisputeInputSchema>;

export const AdvocateBriefSchema = z.object({
  role: z.enum(["buyer_advocate", "merchant_advocate"]),
  argument: z.string().min(10),
  citedEvidenceIds: z.array(z.string()).min(1),
  faultAssessment: z.string().min(5),
});

export type AdvocateBrief = z.infer<typeof AdvocateBriefSchema>;
