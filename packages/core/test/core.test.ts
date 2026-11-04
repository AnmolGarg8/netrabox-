import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { canonicalJson } from "../src/crypto/canonical-json.js";
import {
  computeEventHash,
  verifyEvidenceChain,
  GENESIS_PREV_HASH,
} from "../src/crypto/hash-chain.js";
import { signHash, verifyHashSignature } from "../src/crypto/signing.js";
import {
  getNextPurchaseState,
  canTransition,
  StateTransitionError,
} from "../src/state-machine/index.js";
import { formatMoney, parseMoneyToMinor } from "../src/money/index.js";
import { TribunalVerdictSchema } from "../src/schemas/tribunal.js";
import type { EvidenceEvent, EvidenceEventBody } from "../src/schemas/evidence.js";

describe("@netrabox/core", () => {
  describe("Canonical JSON & Hashing", () => {
    it("sorts object keys lexicographically", () => {
      const obj1 = { z: 1, a: 2, m: { b: 3, a: 4 } };
      const obj2 = { a: 2, m: { a: 4, b: 3 }, z: 1 };
      expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
      expect(canonicalJson(obj1)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
    });

    it("verifies hash chain integrity on valid chain", () => {
      const body1: EvidenceEventBody = {
        id: "ev_1",
        purchaseId: "pur_1",
        seq: 1,
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Buy headphones" },
        createdAt: "2026-11-04T12:00:00.000Z",
        prevHash: GENESIS_PREV_HASH,
        signerKeyId: "key_1",
      };
      const hash1 = computeEventHash(body1);
      const ev1: EvidenceEvent = { ...body1, hash: hash1, signature: "sig1" };

      const body2: EvidenceEventBody = {
        id: "ev_2",
        purchaseId: "pur_1",
        seq: 2,
        type: "CONSTRAINTS_EXTRACTED",
        actor: "agent",
        payload: { maxPrice: 35000 },
        createdAt: "2026-11-04T12:00:01.000Z",
        prevHash: hash1,
        signerKeyId: "key_1",
      };
      const hash2 = computeEventHash(body2);
      const ev2: EvidenceEvent = { ...body2, hash: hash2, signature: "sig2" };

      const outcome = verifyEvidenceChain([ev1, ev2]);
      expect(outcome.valid).toBe(true);
      expect(outcome.totalEvents).toBe(2);
      expect(outcome.lastHash).toBe(hash2);
    });

    it("detects tampering when an event payload is modified", () => {
      const body1: EvidenceEventBody = {
        id: "ev_1",
        purchaseId: "pur_1",
        seq: 1,
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Buy headphones" },
        createdAt: "2026-11-04T12:00:00.000Z",
        prevHash: GENESIS_PREV_HASH,
        signerKeyId: "key_1",
      };
      const hash1 = computeEventHash(body1);
      const ev1: EvidenceEvent = { ...body1, hash: hash1, signature: "sig1" };

      // Tamper: alter payload without updating hash
      ev1.payload = { prompt: "Buy expensive luxury watch" };

      const outcome = verifyEvidenceChain([ev1]);
      expect(outcome.valid).toBe(false);
      expect(outcome.brokenSeq).toBe(1);
    });
  });

  describe("Ed25519 Signing", () => {
    it("signs and verifies hashes using Ed25519 keys", () => {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const privHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
      const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

      const testHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const sig = signHash(testHash, privHex);
      expect(sig).toBeDefined();

      const isValid = verifyHashSignature(testHash, sig, pubHex);
      expect(isValid).toBe(true);

      const isInvalid = verifyHashSignature("tampered_hash", sig, pubHex);
      expect(isInvalid).toBe(false);
    });
  });

  describe("Money Invariants", () => {
    it("formats minor units to major currency string", () => {
      expect(formatMoney(34999, "USD")).toBe("USD 349.99");
      expect(formatMoney(1050, "USD")).toBe("USD 10.50");
    });

    it("parses major amount string or number to integer minor units", () => {
      expect(parseMoneyToMinor("349.99")).toBe(34999);
      expect(parseMoneyToMinor(10.5)).toBe(1050);
    });
  });

  describe("State Machine Invariants", () => {
    it("allows legal state transitions", () => {
      expect(getNextPurchaseState("DRAFT", "PASS_INTENT_CHECK")).toBe("INTENT_CHECKED");
      expect(getNextPurchaseState("INTENT_CHECKED", "REQUEST_APPROVAL")).toBe(
        "AWAITING_BUYER_APPROVAL",
      );
      expect(getNextPurchaseState("AWAITING_BUYER_APPROVAL", "APPROVE_AND_AUTHORIZE")).toBe(
        "AUTHORIZED",
      );
      expect(getNextPurchaseState("AUTHORIZED", "RECORD_DELIVERY")).toBe("DELIVERED");
      expect(getNextPurchaseState("DELIVERED", "CAPTURE_PAYMENT")).toBe("CAPTURED");
      expect(getNextPurchaseState("CAPTURED", "OPEN_DISPUTE")).toBe("DISPUTED");
      expect(getNextPurchaseState("DISPUTED", "RESOLVE_REFUND_FULL")).toBe(
        "RESOLVED_REFUNDED_FULL",
      );
    });

    it("throws StateTransitionError on illegal transitions", () => {
      expect(() => getNextPurchaseState("DRAFT", "CAPTURE_PAYMENT")).toThrow(StateTransitionError);
      expect(canTransition("AUTHORIZED", "CAPTURE_PAYMENT")).toBe(false);
    });
  });

  describe("Zod Tribunal Schema", () => {
    it("validates valid tribunal verdict and enforces split sum === 100", () => {
      const validVerdict = {
        classification: "MERCHANT_MISDESCRIBED",
        liabilitySplit: { buyer: 0, agentProvider: 0, merchant: 100 },
        refundAmountMinor: 34999,
        confidence: 0.95,
        citedEvidenceIds: ["ev_1", "ev_2"],
        reasoning: "Merchant advertised new headphones but shipped refurbished unit.",
        recommendedAction: "REFUND_FULL",
      };
      const parsed = TribunalVerdictSchema.safeParse(validVerdict);
      expect(parsed.success).toBe(true);

      const invalidSplitVerdict = {
        ...validVerdict,
        liabilitySplit: { buyer: 10, agentProvider: 0, merchant: 80 }, // sums to 90
      };
      const failed = TribunalVerdictSchema.safeParse(invalidSplitVerdict);
      expect(failed.success).toBe(false);
    });
  });
});
