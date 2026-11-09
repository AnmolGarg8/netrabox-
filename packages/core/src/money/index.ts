export interface Money {
  amountMinor: number;
  currency: string;
}

/**
 * Currencies that do not use decimal minor units (zero-decimal currencies).
 * In ISO 4217 / PayPal APIs, amounts in these currencies are represented as whole integers without decimal points.
 */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "JPY", // Japanese Yen
  "HUF", // Hungarian Forint
  "TWD", // New Taiwan Dollar
]);

/**
 * Standard two-decimal currencies supported by PayPal.
 */
export const TWO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "CZK",
  "DKK",
  "HKD",
  "ILS",
  "MXN",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "SEK",
  "SGD",
  "THB",
]);

/**
 * Validates and normalizes an ISO 4217 currency code.
 * Rejects unsupported currency codes.
 */
export function validateCurrency(currency: string): string {
  if (typeof currency !== "string") {
    throw new Error(`Currency must be a string, got: ${typeof currency}`);
  }
  const normalized = currency.toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid ISO 4217 currency code: '${currency}'`);
  }
  if (!ZERO_DECIMAL_CURRENCIES.has(normalized) && !TWO_DECIMAL_CURRENCIES.has(normalized)) {
    throw new Error(`Unsupported currency code: '${normalized}'`);
  }
  return normalized;
}

/**
 * Converts a PayPal decimal string to integer minor units using string and integer arithmetic only (no parseFloat).
 *
 * Rules:
 * - Currency-aware: zero-decimal currencies (JPY, HUF, TWD) reject decimal points; two-decimal currencies accept at most 2 decimal digits.
 * - Rejects malformed strings (e.g. non-numeric, multiple decimal points, trailing garbage).
 * - Rejects negative amounts where not allowed.
 * - Rejects amounts that would exceed Number.MAX_SAFE_INTEGER minor units (9,007,199,254,740,991).
 */
export function payPalDecimalToMinor(amountDecimal: string, currency = "USD"): number {
  if (typeof amountDecimal !== "string") {
    throw new Error(`Amount must be a string, got: ${typeof amountDecimal}`);
  }

  const str = amountDecimal.trim();
  if (str.length === 0) {
    throw new Error("Amount string cannot be empty");
  }

  // Reject negative values
  if (str.includes("-")) {
    throw new Error(`Negative amounts are not allowed: '${amountDecimal}'`);
  }

  const curr = validateCurrency(currency);
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(curr);

  if (isZeroDecimal) {
    // Zero-decimal currency: must be an unsigned integer without decimal point
    if (!/^\d+$/.test(str)) {
      throw new Error(
        `Invalid zero-decimal amount for ${curr}: '${amountDecimal}'. Decimals are not supported.`,
      );
    }
    const minor = BigInt(str);
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Amount ${amountDecimal} ${curr} exceeds Number.MAX_SAFE_INTEGER minor units`,
      );
    }
    return Number(minor);
  }

  // Two-decimal currency: must match digits with at most 2 decimal places (e.g. "19.99", "10", "0.5")
  // Rejects 3 or more decimal places (e.g. "1.005")
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid PayPal decimal amount format for ${curr}: '${amountDecimal}'`);
  }

  const parts = str.split(".");
  const wholeStr = parts[0];
  const fracStr = parts[1] ?? "";

  const wholeBi = BigInt(wholeStr);
  let minorBi: bigint;

  if (fracStr.length === 0) {
    minorBi = wholeBi * 100n;
  } else if (fracStr.length === 1) {
    minorBi = wholeBi * 100n + BigInt(fracStr) * 10n;
  } else {
    // length === 2
    minorBi = wholeBi * 100n + BigInt(fracStr);
  }

  if (minorBi > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Amount ${amountDecimal} ${curr} exceeds Number.MAX_SAFE_INTEGER minor units`);
  }

  return Number(minorBi);
}

/**
 * Converts integer minor units to a PayPal decimal string using integer and string formatting only (no parseFloat/toFixed).
 *
 * Rules:
 * - Currency-aware: outputs whole number for zero-decimal currencies (JPY), two decimal places for two-decimal currencies.
 * - Rejects non-integers, negative numbers, and numbers exceeding Number.MAX_SAFE_INTEGER.
 */
export function minorToPayPalDecimal(amountMinor: number, currency = "USD"): string {
  if (
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new Error(
      `Amount in minor units must be a non-negative safe integer, got: ${amountMinor}`,
    );
  }

  const curr = validateCurrency(currency);
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(curr);

  if (isZeroDecimal) {
    return amountMinor.toString();
  }

  const bi = BigInt(amountMinor);
  const whole = (bi / 100n).toString();
  const frac = (bi % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

/**
 * Allocates an integer minor amount across percentage weights using the Largest-Remainder Method (Hare-Niemeyer).
 * Guarantees that the sum of the allocated parts always equals amountMinor exactly.
 *
 * Example: 10001 split 3 ways ([33.333333333333336, 33.333333333333336, 33.333333333333336]) -> [3334, 3334, 3333]
 */
export function allocateByPercent(amountMinor: number, percents: number[]): number[] {
  if (
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0
  ) {
    throw new Error(
      `Amount in minor units must be a non-negative safe integer, got: ${amountMinor}`,
    );
  }

  if (!Array.isArray(percents) || percents.length === 0) {
    throw new Error("Percents array must be non-empty");
  }

  for (let i = 0; i < percents.length; i++) {
    const p = percents[i];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
      throw new Error(`Percent at index ${i} must be a non-negative finite number, got: ${p}`);
    }
  }

  if (amountMinor === 0) {
    return new Array(percents.length).fill(0);
  }

  const totalPercent = percents.reduce((sum, p) => sum + p, 0);
  if (totalPercent <= 0) {
    throw new Error("Total percentage must be greater than zero when allocating non-zero amount");
  }

  // Calculate exact shares and base integer allocations
  const exactShares = percents.map((p) => (amountMinor * p) / totalPercent);
  const baseShares = exactShares.map((s) => Math.floor(s));

  // Determine unallocated remainder units
  const allocatedSum = baseShares.reduce((sum, s) => sum + s, 0);
  const unallocated = amountMinor - allocatedSum;

  // Largest-remainder distribution: sort by fractional remainder descending
  const remainderItems = exactShares.map((s, idx) => ({
    remainder: s - baseShares[idx],
    index: idx,
  }));

  remainderItems.sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder;
    }
    // Stable tie-breaker: lower index receives priority
    return a.index - b.index;
  });

  for (let i = 0; i < unallocated; i++) {
    const targetIdx = remainderItems[i % remainderItems.length].index;
    baseShares[targetIdx] += 1;
  }

  return baseShares;
}

export function formatMoney(amountMinor: number, currency = "USD"): string {
  const decimal = minorToPayPalDecimal(amountMinor, currency);
  return `${currency} ${decimal}`;
}

export function parseMoneyToMinor(amountMajor: string | number, currency = "USD"): number {
  if (typeof amountMajor === "number") {
    if (!Number.isFinite(amountMajor) || amountMajor < 0) {
      throw new Error(`Invalid amount number: ${amountMajor}`);
    }
    // Convert number to decimal string representation to avoid float inaccuracies
    return payPalDecimalToMinor(amountMajor.toString(), currency);
  }
  return payPalDecimalToMinor(amountMajor, currency);
}

export function minorToMajorString(amountMinor: number, currency = "USD"): string {
  return minorToPayPalDecimal(amountMinor, currency);
}
