import { z } from "zod";

export const PayPalIntentSchema = z.literal("AUTHORIZE");

export const PayPalAmountSchema = z.object({
  currency_code: z.string().length(3).default("USD"),
  value: z.string().regex(/^\d+\.\d{2}$/),
});

export const PayPalPurchaseUnitSchema = z.object({
  reference_id: z.string(),
  amount: PayPalAmountSchema,
  description: z.string().optional(),
});

export const CreatePayPalOrderInputSchema = z.object({
  intent: PayPalIntentSchema,
  purchase_units: z.array(PayPalPurchaseUnitSchema).min(1),
  application_context: z.object({
    return_url: z.string().url(),
    cancel_url: z.string().url(),
    user_action: z.enum(["CONTINUE", "PAY_NOW"]).default("CONTINUE"),
  }),
});

export type CreatePayPalOrderInput = z.infer<typeof CreatePayPalOrderInputSchema>;

export const PayPalWebhookVerificationSchema = z.object({
  auth_algo: z.string(),
  cert_url: z.string().url(),
  transmission_id: z.string(),
  transmission_sig: z.string(),
  transmission_time: z.string(),
  webhook_id: z.string(),
  webhook_event: z.record(z.string(), z.unknown()),
});

export type PayPalWebhookVerification = z.infer<typeof PayPalWebhookVerificationSchema>;
