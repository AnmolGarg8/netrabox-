import { describe, it, expect } from "vitest";
import {
  minorToPayPalDecimal,
  payPalDecimalToMinor,
  validateCurrency,
} from "../src/utils/money.js";

describe("Money Utilities", () => {
  it("converts minor units (cents) to PayPal decimal strings", () => {
    expect(minorToPayPalDecimal(34999)).toBe("349.99");
    expect(minorToPayPalDecimal(1050)).toBe("10.50");
    expect(minorToPayPalDecimal(5)).toBe("0.05");
    expect(minorToPayPalDecimal(0)).toBe("0.00");
  });

  it("throws error for non-integer or negative minor units", () => {
    expect(() => minorToPayPalDecimal(-100)).toThrow();
    expect(() => minorToPayPalDecimal(10.5)).toThrow();
  });

  it("converts PayPal decimal strings to integer minor units", () => {
    expect(payPalDecimalToMinor("349.99")).toBe(34999);
    expect(payPalDecimalToMinor("10.50")).toBe(1050);
    expect(payPalDecimalToMinor("0.05")).toBe(5);
    expect(payPalDecimalToMinor("0.00")).toBe(0);
  });

  it("throws error for malformed PayPal decimal strings", () => {
    expect(() => payPalDecimalToMinor("abc")).toThrow();
    expect(() => payPalDecimalToMinor("12.345")).toThrow();
  });

  it("validates and normalizes 3-letter ISO currency codes", () => {
    expect(validateCurrency("usd")).toBe("USD");
    expect(validateCurrency(" EUR ")).toBe("EUR");
    expect(() => validateCurrency("US")).toThrow();
    expect(() => validateCurrency("USDT")).toThrow();
  });
});
