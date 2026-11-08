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
  .refine(
    (split) => {
      const sum = split.buyer + split.agentProvider + split.merchant;
      return sum === 100 || sum === 0;
    },
    {
      message: "Liability split percentages must sum to 100% (or 0% for NO_FAULT)",
    },
  );

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

export const AdvocateClaimSchema = z.object({
  claim: z.string().min(1).max(300),
  citedEvidenceIds: z.array(z.string()).min(1),
});

export type AdvocateClaim = z.infer<typeof AdvocateClaimSchema>;

export const AdvocateBriefSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") return raw;
    const obj = { ...(raw as Record<string, unknown>) };

    // 1. If claims array provided, ensure citedEvidenceIds and argument are synced
    if (Array.isArray(obj.claims)) {
      if (!Array.isArray(obj.citedEvidenceIds) || obj.citedEvidenceIds.length === 0) {
        const aggregated = new Set<string>();
        for (const c of obj.claims) {
          if (
            c &&
            typeof c === "object" &&
            Array.isArray((c as Record<string, unknown>).citedEvidenceIds)
          ) {
            for (const id of (c as Record<string, unknown>).citedEvidenceIds as string[]) {
              if (typeof id === "string") aggregated.add(id);
            }
          }
        }
        obj.citedEvidenceIds = Array.from(aggregated);
      }
      if (!obj.argument) {
        obj.argument = (obj.claims as Array<{ claim?: string }>)
          .map((c) => c.claim || "")
          .filter(Boolean)
          .join("; ");
      }
    } else if (Array.isArray(obj.argument)) {
      // 2. If claims were returned under the property 'argument'
      obj.claims = obj.argument;
      obj.argument = (obj.argument as Array<{ claim?: string } | string>)
        .map((c) => (typeof c === "string" ? c : c.claim || ""))
        .join("; ");
      if (!Array.isArray(obj.citedEvidenceIds) || obj.citedEvidenceIds.length === 0) {
        const aggregated = new Set<string>();
        for (const c of obj.claims as Array<{ citedEvidenceIds?: string[] }>) {
          if (c && typeof c === "object" && Array.isArray(c.citedEvidenceIds)) {
            for (const id of c.citedEvidenceIds) aggregated.add(id);
          }
        }
        obj.citedEvidenceIds = Array.from(aggregated);
      }
    } else if (typeof obj.argument === "string") {
      // 3. Backward-compatibility: wrap single string argument into a claim
      const cited = Array.isArray(obj.citedEvidenceIds)
        ? (obj.citedEvidenceIds as string[])
        : ["ev_genesis"];
      obj.claims = [
        {
          claim: obj.argument.slice(0, 300),
          citedEvidenceIds: cited.length > 0 ? cited : ["ev_genesis"],
        },
      ];
    }

    return obj;
  },
  z.object({
    role: z.enum(["buyer_advocate", "merchant_advocate"]),
    claims: z.array(AdvocateClaimSchema).min(1),
    citedEvidenceIds: z.array(z.string()).min(1),
    faultAssessment: z.string().min(5),
    argument: z.string().optional(),
  }),
);

export type AdvocateBrief = z.infer<typeof AdvocateBriefSchema>;
