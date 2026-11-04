import { z } from "zod";

export const StructuredConstraintsSchema = z.object({
  budgetMinor: z.number().int().positive(),
  brand: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  mustHaves: z.array(z.string()).default([]),
  forbidden: z.array(z.string()).default([]),
});

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
