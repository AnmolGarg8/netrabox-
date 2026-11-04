export type PayPalErrorCategory =
  | "AUTH_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "INVALID_REQUEST"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class PayPalError extends Error {
  public readonly status: number;
  public readonly category: PayPalErrorCategory;
  public readonly isRetryable: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    category: PayPalErrorCategory,
    isRetryable: boolean,
    details?: unknown,
  ) {
    super(`[PayPal] ${category} (HTTP ${status}): ${message}`);
    this.name = "PayPalError";
    this.status = status;
    this.category = category;
    this.isRetryable = isRetryable;
    this.details = details;
  }
}

export function classifyPayPalError(
  status: number,
  message: string,
  details?: unknown,
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

  return new PayPalError(message, status, category, isRetryable, details);
}
