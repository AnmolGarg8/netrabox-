import { describe, it, expect } from "vitest";
import {
  minorToPayPalDecimal,
  payPalDecimalToMinor,
  validateCurrency,
  allocateByPercent,
} from "../src/utils/money.js";

describe("Harden Money Utilities (String & Integer Arithmetic)", () => {
  describe("payPalDecimalToMinor", () => {
    it("parses precision test strings without floating point error: 19.99, 29.99, 0.07, 0.10", () => {
      expect(payPalDecimalToMinor("19.99")).toBe(1999);
      expect(payPalDecimalToMinor("29.99")).toBe(2999);
      expect(payPalDecimalToMinor("0.07")).toBe(7);
      expect(payPalDecimalToMinor("0.10")).toBe(10);
      expect(payPalDecimalToMinor("0.1")).toBe(10);
      expect(payPalDecimalToMinor("349.99")).toBe(34999);
    });

    it("rejects malformed strings with 3+ decimal digits (e.g. '1.005')", () => {
      expect(() => payPalDecimalToMinor("1.005")).toThrow(/Invalid PayPal decimal amount format/);
      expect(() => payPalDecimalToMinor("12.345")).toThrow(/Invalid PayPal decimal amount format/);
      expect(() => payPalDecimalToMinor("0.001")).toThrow(/Invalid PayPal decimal amount format/);
    });

    it("rejects negative strings", () => {
      expect(() => payPalDecimalToMinor("-19.99")).toThrow(/Negative amounts are not allowed/);
      expect(() => payPalDecimalToMinor("-0.01")).toThrow(/Negative amounts are not allowed/);
      expect(() => payPalDecimalToMinor("-100")).toThrow(/Negative amounts are not allowed/);
      expect(() => payPalDecimalToMinor("-0")).toThrow(/Negative amounts are not allowed/);
    });

    it("rejects non-numeric and malformed strings", () => {
      expect(() => payPalDecimalToMinor("abc")).toThrow();
      expect(() => payPalDecimalToMinor("")).toThrow();
      expect(() => payPalDecimalToMinor("  ")).toThrow();
      expect(() => payPalDecimalToMinor("19.99.00")).toThrow();
      expect(() => payPalDecimalToMinor("19,99")).toThrow();
      expect(() => payPalDecimalToMinor("$19.99")).toThrow();
    });

    it("handles zero-decimal currency JPY correctly and rejects decimals in JPY", () => {
      expect(payPalDecimalToMinor("500", "JPY")).toBe(500);
      expect(payPalDecimalToMinor("0", "JPY")).toBe(0);
      expect(payPalDecimalToMinor("125000", "JPY")).toBe(125000);

      // Decimals must be rejected for JPY
      expect(() => payPalDecimalToMinor("500.00", "JPY")).toThrow(
        /Decimals are not supported/,
      );
      expect(() => payPalDecimalToMinor("500.5", "JPY")).toThrow(
        /Decimals are not supported/,
      );
    });

    it("handles two-decimal currency EUR correctly", () => {
      expect(payPalDecimalToMinor("19.99", "EUR")).toBe(1999);
      expect(payPalDecimalToMinor("250.00", "EUR")).toBe(25000);
      expect(payPalDecimalToMinor("0.05", "EUR")).toBe(5);
    });

    it("rejects unsupported currencies", () => {
      expect(() => payPalDecimalToMinor("100.00", "XYZ")).toThrow(/Unsupported currency code/);
      expect(() => payPalDecimalToMinor("100.00", "BTC")).toThrow(/Unsupported currency code/);
    });

    it("respects boundary values and Number.MAX_SAFE_INTEGER", () => {
      expect(payPalDecimalToMinor("0.00")).toBe(0);
      expect(payPalDecimalToMinor("0")).toBe(0);

      // Number.MAX_SAFE_INTEGER is 9007199254740991 cents ($90,071,992,547,409.91)
      const maxSafeDecimal = "90071992547409.91";
      expect(payPalDecimalToMinor(maxSafeDecimal)).toBe(Number.MAX_SAFE_INTEGER);

      // Above Number.MAX_SAFE_INTEGER minor units must throw
      const aboveMaxSafeDecimal = "90071992547409.92";
      expect(() => payPalDecimalToMinor(aboveMaxSafeDecimal)).toThrow(
        /exceeds Number\.MAX_SAFE_INTEGER/,
      );

      // JPY max safe integer
      expect(payPalDecimalToMinor(Number.MAX_SAFE_INTEGER.toString(), "JPY")).toBe(
        Number.MAX_SAFE_INTEGER,
      );
      expect(() =>
        payPalDecimalToMinor("9007199254740992", "JPY"),
      ).toThrow(/exceeds Number\.MAX_SAFE_INTEGER/);
    });
  });

  describe("minorToPayPalDecimal", () => {
    it("converts integer minor units to two-decimal strings using integer arithmetic", () => {
      expect(minorToPayPalDecimal(1999)).toBe("19.99");
      expect(minorToPayPalDecimal(2999)).toBe("29.99");
      expect(minorToPayPalDecimal(7)).toBe("0.07");
      expect(minorToPayPalDecimal(10)).toBe("0.10");
      expect(minorToPayPalDecimal(34999)).toBe("349.99");
      expect(minorToPayPalDecimal(0)).toBe("0.00");
    });

    it("converts zero-decimal currencies (JPY) without decimal point", () => {
      expect(minorToPayPalDecimal(500, "JPY")).toBe("500");
      expect(minorToPayPalDecimal(0, "JPY")).toBe("0");
      expect(minorToPayPalDecimal(125000, "JPY")).toBe("125000");
    });

    it("converts EUR amounts correctly", () => {
      expect(minorToPayPalDecimal(1999, "EUR")).toBe("19.99");
      expect(minorToPayPalDecimal(25000, "EUR")).toBe("250.00");
    });

    it("handles boundary values up to Number.MAX_SAFE_INTEGER", () => {
      expect(minorToPayPalDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
      expect(minorToPayPalDecimal(Number.MAX_SAFE_INTEGER, "JPY")).toBe("9007199254740991");
    });

    it("throws for non-integer, negative, or unsafe numbers", () => {
      expect(() => minorToPayPalDecimal(-1)).toThrow();
      expect(() => minorToPayPalDecimal(10.5)).toThrow();
      expect(() => minorToPayPalDecimal(Number.MAX_SAFE_INTEGER + 1)).toThrow();
      expect(() => minorToPayPalDecimal(NaN)).toThrow();
      expect(() => minorToPayPalDecimal(Infinity)).toThrow();
    });
  });

  describe("allocateByPercent (Largest-Remainder Method)", () => {
    it("splits 10001 three ways with exact sum conservation", () => {
      // 10001 split three ways (each 33.333333333333336%)
      const threeWayPercents = [100 / 3, 100 / 3, 100 / 3];
      const parts = allocateByPercent(10001, threeWayPercents);

      expect(parts).toEqual([3334, 3334, 3333]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10001);

      // Using integer weights [1, 1, 1]
      const partsWeights = allocateByPercent(10001, [1, 1, 1]);
      expect(partsWeights).toEqual([3334, 3334, 3333]);
      expect(partsWeights.reduce((a, b) => a + b, 0)).toBe(10001);
    });

    it("handles 1 unit split two ways [50, 50]", () => {
      const parts = allocateByPercent(1, [50, 50]);
      expect(parts).toEqual([1, 0]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(1);
    });

    it("handles 0 amount minor", () => {
      const parts = allocateByPercent(0, [40, 40, 20]);
      expect(parts).toEqual([0, 0, 0]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(0);
    });

    it("handles clean splits", () => {
      const parts = allocateByPercent(10000, [70, 20, 10]);
      expect(parts).toEqual([7000, 2000, 1000]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    });

    it("conserves total across 1000 random test inputs (property-based conservation test)", () => {
      for (let i = 0; i < 1000; i++) {
        // Random amount between 0 and 1,000,000 minor units
        const amount = Math.floor(Math.random() * 1000000);

        // Random number of buckets between 2 and 6
        const numBuckets = Math.floor(Math.random() * 5) + 2;
        const percents = Array.from({ length: numBuckets }, () => Math.random() * 100 + 0.1);

        const allocation = allocateByPercent(amount, percents);

        // Invariant 1: Result length matches percents length
        expect(allocation).toHaveLength(numBuckets);

        // Invariant 2: Every allocation is an integer >= 0
        for (const item of allocation) {
          expect(Number.isInteger(item)).toBe(true);
          expect(item).toBeGreaterThanOrEqual(0);
        }

        // Invariant 3: EXACT SUM CONSERVATION
        const sum = allocation.reduce((a, b) => a + b, 0);
        expect(sum).toBe(amount);
      }
    });

    it("throws on invalid inputs", () => {
      expect(() => allocateByPercent(-10, [50, 50])).toThrow();
      expect(() => allocateByPercent(100, [])).toThrow();
      expect(() => allocateByPercent(100, [-10, 60])).toThrow();
      expect(() => allocateByPercent(100, [0, 0])).toThrow();
    });
  });

  describe("Currency Validation", () => {
    it("validates and normalizes 3-letter ISO currency codes", () => {
      expect(validateCurrency("usd")).toBe("USD");
      expect(validateCurrency(" EUR ")).toBe("EUR");
      expect(validateCurrency("jpy")).toBe("JPY");
      expect(() => validateCurrency("US")).toThrow();
      expect(() => validateCurrency("USDT")).toThrow();
    });
  });
});
