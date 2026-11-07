export type PayPalErrorCategory =
  | "AUTH_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_REQUEST"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface SanitizedPayPalErrorDetails {
  status: number;
  paypalErrorName: string;
  message: string;
  debug_id?: string;
}

/**
 * Sanitizes an error message string to ensure raw authorization tokens,
 * client secrets, or raw JSON response dumps cannot leak into error strings.
 */
function sanitizeErrorMessage(msg: string): string {
  if (!msg || typeof msg !== "string") return "Unknown PayPal error";

  return msg
    // Redact Bearer / Basic auth tokens
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [REDACTED]")
    // Redact client_secret, token, or password key-value patterns
    .replace(/(client_secret|access_token|refresh_token|password|secret)[=:][\s"']*[^&"'\s,\}]+/gi, "$1=[REDACTED]")
    // Truncate excessively long message strings that might be raw dumps
    .slice(0, 500);
}

export class PayPalError extends Error {
  public readonly status: number;
  public readonly category: PayPalErrorCategory;
  public readonly isRetryable: boolean;
  public readonly paypalErrorName: string;
  public readonly debug_id?: string;
  public readonly details: SanitizedPayPalErrorDetails;

  constructor(
    message: string,
    status: number,
    category: PayPalErrorCategory,
    isRetryable: boolean,
    sanitized: { paypalErrorName: string; debug_id?: string },
  ) {
    const cleanMessage = sanitizeErrorMessage(message);
    super(`[PayPal] ${category} (HTTP ${status}): ${cleanMessage}`);
    this.name = "PayPalError";
    this.status = status;
    this.category = category;
    this.isRetryable = isRetryable;
    this.paypalErrorName = sanitized.paypalErrorName;
    this.debug_id = sanitized.debug_id;

    // Invariant: The error details object strictly keeps only:
    // HTTP status, PayPal error name, message, and debug_id.
    // Raw response bodies, payloads, and request headers are NEVER attached.
    this.details = {
      status,
      paypalErrorName: this.paypalErrorName,
      message: cleanMessage,
      debug_id: this.debug_id,
    };
  }

  public toJSON(): SanitizedPayPalErrorDetails & { category: PayPalErrorCategory; isRetryable: boolean } {
    return {
      status: this.status,
      category: this.category,
      isRetryable: this.isRetryable,
      paypalErrorName: this.paypalErrorName,
      message: this.message,
      debug_id: this.debug_id,
    };
  }
}

/**
 * Classifies PayPal responses into sanitized, structured PayPalError objects.
 * Strict invariant: Error objects keep ONLY:
 * - HTTP status
 * - PayPal error name
 * - message
 * - debug_id
 *
 * Never attaches raw response bodies or request headers.
 */
export function classifyPayPalError(
  status: number,
  fallbackMessage: string,
  rawPayload?: unknown,
): PayPalError {
  let category: PayPalErrorCategory = "UNKNOWN";
  let isRetryable = false;

  if (status === 401 || status === 403) {
    category = "AUTH_FAILED";
    isRetryable = false;
  } else if (status === 404) {
    category = "RESOURCE_NOT_FOUND";
    isRetryable = false;
  } else if (status === 400 || status === 422) {
    category = "INVALID_REQUEST";
    isRetryable = false;
  } else if (status === 429) {
    category = "RATE_LIMIT";
    isRetryable = true;
  } else if (status >= 500 && status <= 599) {
    category = "SERVER_ERROR";
    isRetryable = true;
  } else if (status === 0) {
    category = "NETWORK_ERROR";
    isRetryable = true;
  }

  let extractedName: string | undefined;
  let extractedMessage: string | undefined;
  let extractedDebugId: string | undefined;

  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    const obj = rawPayload as Record<string, unknown>;

    if (typeof obj.name === "string") extractedName = obj.name;
    else if (typeof obj.error === "string") extractedName = obj.error;

    if (typeof obj.message === "string") extractedMessage = obj.message;
    else if (typeof obj.error_description === "string") extractedMessage = obj.error_description;

    if (typeof obj.debug_id === "string") extractedDebugId = obj.debug_id;
    else if (typeof obj.debugId === "string") extractedDebugId = obj.debugId;
  }

  const finalName = extractedName || (status === 401 ? "AUTHENTICATION_FAILURE" : category);
  const finalMessage = extractedMessage || fallbackMessage;

  return new PayPalError(finalMessage, status, category, isRetryable, {
    paypalErrorName: finalName,
    debug_id: extractedDebugId,
  });
}
