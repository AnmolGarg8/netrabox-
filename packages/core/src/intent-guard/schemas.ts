import { z } from "zod";

export const StructuredConstraintsSchema = z.preprocess(
  (raw: unknown) => {
    if (!raw || typeof raw !== "object") return raw;
    const obj = { ...(raw as Record<string, unknown>) };

    // If LLM returned 'budget' in dollars instead of 'budgetMinor' in cents
    if (obj.budgetMinor === undefined && typeof obj.budget === "number") {
      obj.budgetMinor = Math.round(obj.budget * 100);
    } else if (typeof obj.budgetMinor === "string") {
      const parsed = Number(obj.budgetMinor);
      if (!isNaN(parsed) && parsed > 0) obj.budgetMinor = parsed;
    }

    if (!Array.isArray(obj.ambiguousFields)) {
      obj.ambiguousFields = [];
    }
    if (!Array.isArray(obj.mustHaves)) {
      obj.mustHaves = typeof obj.mustHaves === "string" ? [obj.mustHaves] : [];
    }
    if (!Array.isArray(obj.forbidden)) {
      obj.forbidden = typeof obj.forbidden === "string" ? [obj.forbidden] : [];
    }

    return obj;
  },
  z.object({
    budgetMinor: z.number().int().positive().optional(),
    currency: z.string().default("USD"),
    itemDescription: z.string().default(""),
    brand: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    quantity: z.number().int().positive().default(1),
    mustHaves: z.array(z.string()).default([]),
    forbidden: z.array(z.string()).default([]),
    deadline: z.string().optional(),
    ambiguousFields: z.array(z.string()).default([]),
  }),
);

export type StructuredConstraints = z.infer<typeof StructuredConstraintsSchema>;

export const IntentGuardStatusSchema = z.enum(["PASS", "WARN", "BLOCK"]);
export type IntentGuardStatus = z.infer<typeof IntentGuardStatusSchema>;

export const IntentGuardResultSchema = z.object({
  status: IntentGuardStatusSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  understoodSummary: z.string(),
  constraints: StructuredConstraintsSchema,
});

export type IntentGuardResult = z.infer<typeof IntentGuardResultSchema>;
