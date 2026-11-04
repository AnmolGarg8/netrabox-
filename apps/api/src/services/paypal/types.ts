import { z } from "zod";

export const PayPalEnvironmentSchema = z.enum(["sandbox", "live"]).default("sandbox");

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  baseUrl?: string;
  webhookId?: string;
}

export interface PayPalTokenResponse {
  scope: string;
  access_token: string;
  token_type: string;
  app_id: string;
  expires_in: number;
  nonce: string;
}

export interface PayPalOrderResponse {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  intent: "AUTHORIZE" | "CAPTURE";
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
  purchase_units: Array<{
    reference_id: string;
    amount: {
      currency_code: string;
      value: string;
    };
  }>;
}

export interface PayPalAuthorizeResponse {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_COMPLETED" | "PENDING" | "FAILED";
  purchase_units: Array<{
    reference_id: string;
    payments?: {
      authorizations?: Array<{
        id: string;
        status:
          | "CREATED"
          | "CAPTURED"
          | "DENIED"
          | "EXPIRED"
          | "PARTIALLY_CAPTURED"
          | "PENDING"
          | "VOIDED";
        amount: {
          currency_code: string;
          value: string;
        };
        expiration_time?: string;
        create_time?: string;
        update_time?: string;
        links?: Array<{ href: string; rel: string; method: string }>;
      }>;
    };
  }>;
}

export interface PayPalAuthorizationDetail {
  id: string;
  status:
    "CREATED" | "CAPTURED" | "DENIED" | "EXPIRED" | "PARTIALLY_CAPTURED" | "PENDING" | "VOIDED";
  amount: {
    currency_code: string;
    value: string;
  };
  expiration_time?: string;
  create_time?: string;
  update_time?: string;
}

export interface PayPalCaptureResponse {
  id: string;
  status: "COMPLETED" | "DECLINED" | "FAILED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED";
  amount: {
    currency_code: string;
    value: string;
  };
  final_capture: boolean;
  create_time: string;
  update_time: string;
}

export interface PayPalVoidResponse {
  id: string;
  status: "VOIDED";
}

export interface PayPalRefundResponse {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount: {
    currency_code: string;
    value: string;
  };
  note_to_payer?: string;
  create_time: string;
  update_time: string;
}

export interface PayPalWebhookVerificationPayload {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
  webhook_id: string;
  webhook_event: Record<string, unknown>;
}

export interface PayPalWebhookVerificationResponse {
  verification_status: "SUCCESS" | "FAILURE";
}
