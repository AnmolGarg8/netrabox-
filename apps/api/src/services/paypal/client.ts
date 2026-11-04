import {
  type PayPalConfig,
  type PayPalTokenResponse,
  type PayPalOrderResponse,
  type PayPalAuthorizeResponse,
  type PayPalAuthorizationDetail,
  type PayPalCaptureResponse,
  type PayPalVoidResponse,
  type PayPalRefundResponse,
  type PayPalWebhookVerificationPayload,
  type PayPalWebhookVerificationResponse,
} from "./types.js";
import { classifyPayPalError, PayPalError } from "./errors.js";
import { minorToPayPalDecimal, validateCurrency } from "../../utils/money.js";

export interface CustomFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export class PayPalClient {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;
  private webhookId?: string;
  private fetchFn: CustomFetch;

  // Cached OAuth token
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private activeTokenPromise: Promise<string> | null = null;

  constructor(config: PayPalConfig, customFetch?: CustomFetch) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl =
      config.baseUrl ||
      (config.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com");
    this.webhookId = config.webhookId;
    this.fetchFn = customFetch || (globalThis.fetch as CustomFetch);
  }

  /**
   * Generates a deterministic idempotency key for PayPal requests
   */
  public generateIdempotencyKey(purchaseId: string, action: string, attempt = 1): string {
    const sanitizedAction = action.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return attempt === 1
      ? `netrabox_${purchaseId}_${sanitizedAction}`
      : `netrabox_${purchaseId}_${sanitizedAction}_att${attempt}`;
  }

  /**
   * Retrieves a valid OAuth2 access token, refreshing if within 60s of expiration
   */
  public async getAccessToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    const safetyMarginMs = 60 * 1000; // 60 seconds

    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt - now > safetyMarginMs) {
      return this.cachedToken;
    }

    if (this.activeTokenPromise) {
      return this.activeTokenPromise;
    }

    this.activeTokenPromise = (async () => {
      try {
        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
        const response = await this.fetchFn(`${this.baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw classifyPayPalError(response.status, `Failed to authenticate: ${errorBody}`);
        }

        const data = (await response.json()) as PayPalTokenResponse;
        this.cachedToken = data.access_token;
        this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
        return this.cachedToken;
      } finally {
        this.activeTokenPromise = null;
      }
    })();

    return this.activeTokenPromise;
  }

  /**
   * Internal wrapper with token attachment, error classification, and retry for transient failures
   */
  private async request<T>(
    endpoint: string,
    options: {
      method: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
      idempotencyKey?: string;
      maxRetries?: number;
    },
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const token = await this.getAccessToken();
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        };

        if (options.idempotencyKey) {
          headers["PayPal-Request-Id"] = options.idempotencyKey;
        }

        const response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        if (response.status === 204) {
          return {} as T;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(errorBody);
          } catch {
            parsed = errorBody;
          }

          const error = classifyPayPalError(
            response.status,
            `Request to ${endpoint} failed with HTTP ${response.status}`,
            parsed,
          );

          // Retry safe/transient errors
          if (error.isRetryable && attempt <= maxRetries) {
            const backoffMs = Math.pow(2, attempt) * 200;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          throw error;
        }

        return (await response.json()) as T;
      } catch (err) {
        if (err instanceof PayPalError) {
          throw err;
        }

        // Network or fetch exceptions
        const networkError = classifyPayPalError(
          0,
          `Network error contacting PayPal: ${err instanceof Error ? err.message : String(err)}`,
        );

        if (attempt <= maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 200;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        throw networkError;
      }
    }

    throw classifyPayPalError(0, "Max retries exceeded");
  }

  /**
   * 1. Create Order with intent AUTHORIZE
   */
  public async createOrder(params: {
    purchaseId: string;
    amountMinor: number;
    currency?: string;
    returnUrl: string;
    cancelUrl: string;
    description?: string;
  }): Promise<{ order: PayPalOrderResponse; approvalUrl?: string }> {
    const currency = validateCurrency(params.currency || "USD");
    const decimalValue = minorToPayPalDecimal(params.amountMinor);
    const idempotencyKey = this.generateIdempotencyKey(params.purchaseId, "create_order");

    const payload = {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: `purchase_${params.purchaseId}`,
          amount: {
            currency_code: currency,
            value: decimalValue,
          },
          description: params.description || `NetraBox Purchase ${params.purchaseId}`,
        },
      ],
      application_context: {
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        user_action: "CONTINUE",
      },
    };

    const order = await this.request<PayPalOrderResponse>("/v2/checkout/orders", {
      method: "POST",
      body: payload,
      idempotencyKey,
    });

    const approvalUrl = order.links?.find((l) => l.rel === "approve")?.href;
    return { order, approvalUrl };
  }

  /**
   * 2. Authorize an approved Order
   */
  public async authorizeOrder(
    orderId: string,
    purchaseId: string,
  ): Promise<{
    authorizationResponse: PayPalAuthorizeResponse;
    authorizationId: string;
  }> {
    const idempotencyKey = this.generateIdempotencyKey(purchaseId, "authorize_order");
    const response = await this.request<PayPalAuthorizeResponse>(
      `/v2/checkout/orders/${orderId}/authorize`,
      {
        method: "POST",
        idempotencyKey,
      },
    );

    const authorization = response.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!authorization?.id) {
      throw classifyPayPalError(
        500,
        "Order authorization response did not contain an authorization ID",
        response,
      );
    }

    return {
      authorizationResponse: response,
      authorizationId: authorization.id,
    };
  }

  /**
   * 3. Capture an Authorization (full or partial, with final_capture handling)
   */
  public async captureAuthorization(
    authorizationId: string,
    purchaseId: string,
    options?: {
      amountMinor?: number;
      currency?: string;
      finalCapture?: boolean;
      actionSuffix?: string;
    },
  ): Promise<PayPalCaptureResponse> {
    const action = options?.actionSuffix ? `capture_${options.actionSuffix}` : "capture";
    const idempotencyKey = this.generateIdempotencyKey(purchaseId, action);

    const body: Record<string, unknown> = {};

    if (options?.amountMinor !== undefined) {
      const currency = validateCurrency(options.currency || "USD");
      body.amount = {
        currency_code: currency,
        value: minorToPayPalDecimal(options.amountMinor),
      };
      body.final_capture = options.finalCapture ?? true;
    }

    return await this.request<PayPalCaptureResponse>(
      `/v2/payments/authorizations/${authorizationId}/capture`,
      {
        method: "POST",
        body: Object.keys(body).length > 0 ? body : undefined,
        idempotencyKey,
      },
    );
  }

  /**
   * 4. Void an Authorization
   */
  public async voidAuthorization(
    authorizationId: string,
    purchaseId: string,
  ): Promise<PayPalVoidResponse> {
    const idempotencyKey = this.generateIdempotencyKey(purchaseId, "void");
    return await this.request<PayPalVoidResponse>(
      `/v2/payments/authorizations/${authorizationId}/void`,
      {
        method: "POST",
        idempotencyKey,
      },
    );
  }

  /**
   * 5. Refund a Capture (full or partial)
   */
  public async refundCapture(
    captureId: string,
    purchaseId: string,
    options?: {
      amountMinor?: number;
      currency?: string;
      note?: string;
      actionSuffix?: string;
    },
  ): Promise<PayPalRefundResponse> {
    const action = options?.actionSuffix ? `refund_${options.actionSuffix}` : "refund";
    const idempotencyKey = this.generateIdempotencyKey(purchaseId, action);

    const body: Record<string, unknown> = {};

    if (options?.amountMinor !== undefined) {
      const currency = validateCurrency(options.currency || "USD");
      body.amount = {
        currency_code: currency,
        value: minorToPayPalDecimal(options.amountMinor),
      };
    }

    if (options?.note) {
      body.note_to_payer = options.note;
    }

    return await this.request<PayPalRefundResponse>(`/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      body: Object.keys(body).length > 0 ? body : undefined,
      idempotencyKey,
    });
  }

  /**
   * 6. Get Order Details
   */
  public async getOrder(orderId: string): Promise<PayPalOrderResponse> {
    return await this.request<PayPalOrderResponse>(`/v2/checkout/orders/${orderId}`, {
      method: "GET",
    });
  }

  /**
   * 7. Get Authorization Details
   */
  public async getAuthorization(authorizationId: string): Promise<PayPalAuthorizationDetail> {
    return await this.request<PayPalAuthorizationDetail>(
      `/v2/payments/authorizations/${authorizationId}`,
      {
        method: "GET",
      },
    );
  }

  /**
   * 8. Verify PayPal Webhook Signature
   */
  public async verifyWebhookSignature(params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookEvent: Record<string, unknown>;
  }): Promise<boolean> {
    const webhookId = this.webhookId || process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      throw classifyPayPalError(
        500,
        "PAYPAL_WEBHOOK_ID is not configured for signature verification",
      );
    }

    const payload: PayPalWebhookVerificationPayload = {
      auth_algo: params.authAlgo,
      cert_url: params.certUrl,
      transmission_id: params.transmissionId,
      transmission_sig: params.transmissionSig,
      transmission_time: params.transmissionTime,
      webhook_id: webhookId,
      webhook_event: params.webhookEvent,
    };

    try {
      const response = await this.request<PayPalWebhookVerificationResponse>(
        "/v1/notifications/verify-webhook-signature",
        {
          method: "POST",
          body: payload,
        },
      );
      return response.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }
}
