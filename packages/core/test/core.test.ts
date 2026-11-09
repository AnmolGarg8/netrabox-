import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { canonicalJson } from "../src/crypto/canonical-json.js";
import {
  computeEventHash,
  verifyEvidenceChain,
  GENESIS_PREV_HASH,
} from "../src/crypto/hash-chain.js";
import { signHash, verifyHashSignature } from "../src/crypto/signing.js";
import {
  computeMerkleRoot,
  generateProof,
  verifyProof,
  generateMerkleProof,
  verifyMerkleProof,
} from "../src/crypto/merkle.js";
import {
  getNextPurchaseState,
  canTransition,
  StateTransitionError,
} from "../src/state-machine/index.js";
import {
  formatMoney,
  parseMoneyToMinor,
  payPalDecimalToMinor,
  minorToPayPalDecimal,
  allocateByPercent,
  validateCurrency,
} from "../src/money/index.js";
import { TribunalVerdictSchema } from "../src/schemas/tribunal.js";
import type { EvidenceEvent, EvidenceEventBody } from "../src/schemas/evidence.js";

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

describe("@netrabox/core", () => {
  describe("Canonical JSON Rules", () => {
    it("Rule 1: undefined properties are treated as omitted; arrays represent undefined as null", () => {
      const objWithUndefined = { a: 1, b: undefined, c: { d: undefined, e: 2 } };
      const objOmitted = { a: 1, c: { e: 2 } };

      expect(canonicalJson(objWithUndefined)).toBe(canonicalJson(objOmitted));
      expect(canonicalJson(objWithUndefined)).toBe('{"a":1,"c":{"e":2}}');
      expect(sha256(canonicalJson(objWithUndefined))).toBe(sha256(canonicalJson(objOmitted)));

      // Inside arrays, undefined is serialized as null
      expect(canonicalJson([1, undefined, 3])).toBe("[1,null,3]");
    });

    it("Rule 2: arrays keep exact order", () => {
      const arr1 = [3, 1, 2];
      const arr2 = [1, 2, 3];
      expect(canonicalJson(arr1)).toBe("[3,1,2]");
      expect(canonicalJson(arr1)).not.toBe(canonicalJson(arr2));
    });

    it("Rule 3: nested key permutations hash identically", () => {
      const complex1 = {
        z: { b: 1, a: 2 },
        a: [{ y: 10, x: 20 }, 3],
        m: { k2: "v2", k1: "v1" },
      };
      const complex2 = {
        m: { k1: "v1", k2: "v2" },
        a: [{ y: 10, x: 20 }, 3],
        z: { a: 2, b: 1 },
      };

      const canonical1 = canonicalJson(complex1);
      const canonical2 = canonicalJson(complex2);

      expect(canonical1).toBe(canonical2);
      expect(canonical1).toBe('{"a":[{"x":20,"y":10},3],"m":{"k1":"v1","k2":"v2"},"z":{"a":2,"b":1}}');
      expect(sha256(canonical1)).toBe(sha256(canonical2));
    });

    it("Rule 4 & 5: emoji, Unicode and CRLF are preserved; CRLF and LF are different data", () => {
      // Unicode and emoji preserved without normalization
      const unicodeObj = {
        title: "NetraBox 🛡️ नेत्रボックス",
        currency: "円",
        accent: "Café",
      };
      const canonical = canonicalJson(unicodeObj);
      expect(canonical).toContain("NetraBox 🛡️ नेत्रボックス");
      expect(canonical).toContain("円");
      expect(canonical).toContain("Café");

      // CRLF vs LF are distinct data and hash differently
      const crlfStr = "header\r\nbody\r\nfooter";
      const lfStr = "header\nbody\nfooter";

      expect(canonicalJson(crlfStr)).not.toBe(canonicalJson(lfStr));
      expect(sha256(canonicalJson(crlfStr))).not.toBe(sha256(canonicalJson(lfStr)));
    });
  });

  describe("Ed25519 Signing & Verification", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const privHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
    const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

    const otherPair = generateKeyPairSync("ed25519");
    const otherPubHex = otherPair.publicKey.export({ type: "spki", format: "der" }).toString("hex");

    const testHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    it("signs and verifies hashes using valid Ed25519 keys", () => {
      const sig = signHash(testHash, privHex);
      expect(sig).toBeDefined();

      const isValid = verifyHashSignature(testHash, sig, pubHex);
      expect(isValid).toBe(true);

      const isInvalid = verifyHashSignature("tampered_hash", sig, pubHex);
      expect(isInvalid).toBe(false);
    });

    it("signature verified with the wrong public key fails", () => {
      const sig = signHash(testHash, privHex);
      const isVerifiedWithWrongKey = verifyHashSignature(testHash, sig, otherPubHex);
      expect(isVerifiedWithWrongKey).toBe(false);
    });

    it("malformed signature strings (odd length, non-hex) fail without throwing unhandled errors", () => {
      // Odd length hex strings
      expect(verifyHashSignature(testHash, "abc", pubHex)).toBe(false);
      expect(verifyHashSignature(testHash, "12345", pubHex)).toBe(false);
      expect(verifyHashSignature(testHash, "a", pubHex)).toBe(false);

      // Non-hex strings
      expect(verifyHashSignature(testHash, "not-a-valid-hex-signature-!!", pubHex)).toBe(false);
      expect(verifyHashSignature(testHash, "xyz123", pubHex)).toBe(false);
      expect(verifyHashSignature(testHash, "  ", pubHex)).toBe(false);
      expect(verifyHashSignature(testHash, "", pubHex)).toBe(false);

      // Malformed public key
      const validSig = signHash(testHash, privHex);
      expect(verifyHashSignature(testHash, validSig, "odd_length_pubkey_123")).toBe(false);
      expect(verifyHashSignature(testHash, validSig, "not_hex_key!!")).toBe(false);
    });
  });

  describe("Evidence Hash Chain & Sequence 1 prevHash Invariant", () => {
    it("sequence 1 must have prevHash equal to 64 zeros", () => {
      // Valid sequence 1 with 64 zeros
      const validBody1: EvidenceEventBody = {
        id: "ev_genesis",
        purchaseId: "pur_seq1",
        seq: 1,
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Test Genesis" },
        createdAt: "2026-11-04T12:00:00.000Z",
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
        signerKeyId: "key_1",
      };
      const validHash = computeEventHash(validBody1);
      const evValid: EvidenceEvent = { ...validBody1, hash: validHash, signature: "sig1" };

      expect(verifyEvidenceChain([evValid]).valid).toBe(true);

      // Invalid sequence 1 with non-zero prevHash
      const invalidBody1: EvidenceEventBody = {
        ...validBody1,
        prevHash: "1111111111111111111111111111111111111111111111111111111111111111",
      };
      const invalidHash = computeEventHash(invalidBody1);
      const evInvalid: EvidenceEvent = { ...invalidBody1, hash: invalidHash, signature: "sig1" };

      const outcome = verifyEvidenceChain([evInvalid]);
      expect(outcome.valid).toBe(false);
      expect(outcome.brokenSeq).toBe(1);
      expect(outcome.reason).toContain("Broken prevHash link at seq 1");

      // Invalid sequence 1 with short zeros (e.g. 63 zeros)
      const shortZeroBody: EvidenceEventBody = {
        ...validBody1,
        prevHash: "0".repeat(63),
      };
      const shortZeroHash = computeEventHash(shortZeroBody);
      const evShort: EvidenceEvent = { ...shortZeroBody, hash: shortZeroHash, signature: "sig1" };
      expect(verifyEvidenceChain([evShort]).valid).toBe(false);
    });

    it("verifies hash chain integrity across multi-step lifecycle", () => {
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

  describe("Merkle Inclusion Proofs (generateProof, verifyProof)", () => {
    it("computes Merkle root and handles empty/single/odd leaves", () => {
      expect(computeMerkleRoot([])).toBe("0".repeat(64));

      const singleLeaf = sha256("leaf_1");
      expect(computeMerkleRoot([singleLeaf])).toBe(singleLeaf);

      const twoLeaves = [sha256("leaf_1"), sha256("leaf_2")];
      const expectedRoot = sha256(twoLeaves[0] + twoLeaves[1]);
      expect(computeMerkleRoot(twoLeaves)).toBe(expectedRoot);
    });

    it("Merkle proof verifies for every leaf in various tree sizes (1, 2, 3, 4, 7, 8)", () => {
      const testSizes = [1, 2, 3, 4, 7, 8, 15];

      for (const size of testSizes) {
        const leaves = Array.from({ length: size }, (_, i) => sha256(`leaf_content_${size}_${i}`));
        const root = computeMerkleRoot(leaves);

        for (let i = 0; i < leaves.length; i++) {
          const proof = generateProof(leaves, i);
          expect(proof.leafHash).toBe(leaves[i]);
          expect(proof.leafIndex).toBe(i);
          expect(proof.root).toBe(root);

          // Inclusion proof must verify to true
          const isValid = verifyProof(leaves[i], proof.proof, root);
          expect(isValid).toBe(true);

          // Verify with alias verifyMerkleProof
          expect(verifyMerkleProof(leaves[i], proof.proof, root)).toBe(true);
        }
      }
    });

    it("Merkle proof fails for a tampered leaf", () => {
      const leaves = [sha256("A"), sha256("B"), sha256("C"), sha256("D")];
      const root = computeMerkleRoot(leaves);

      const proofForLeaf0 = generateProof(leaves, 0);

      // Verifies for original leaf
      expect(verifyProof(leaves[0], proofForLeaf0.proof, root)).toBe(true);

      // Fails for tampered leaf hash
      const tamperedLeaf = sha256("TAMPERED_A");
      expect(verifyProof(tamperedLeaf, proofForLeaf0.proof, root)).toBe(false);
    });

    it("Merkle proof fails for tampered proof steps or wrong root", () => {
      const leaves = [sha256("A"), sha256("B"), sha256("C")];
      const root = computeMerkleRoot(leaves);

      const proof = generateProof(leaves, 1);
      expect(verifyProof(leaves[1], proof.proof, root)).toBe(true);

      // Wrong root
      expect(verifyProof(leaves[1], proof.proof, sha256("wrong_root"))).toBe(false);

      // Tampered proof step hash
      const tamperedSteps = [
        { ...proof.proof[0], hash: sha256("tampered_sibling") },
        ...proof.proof.slice(1),
      ];
      expect(verifyProof(leaves[1], tamperedSteps, root)).toBe(false);

      // Tampered proof step position
      const flippedPositionSteps = [
        { ...proof.proof[0], position: proof.proof[0].position === "left" ? "right" : "left" } as any,
        ...proof.proof.slice(1),
      ];
      expect(verifyProof(leaves[1], flippedPositionSteps, root)).toBe(false);
    });
  });

  describe("Money Invariants & Allocation", () => {
    it("formats minor units to major currency string", () => {
      expect(formatMoney(34999, "USD")).toBe("USD 349.99");
      expect(formatMoney(1050, "USD")).toBe("USD 10.50");
      expect(formatMoney(500, "JPY")).toBe("JPY 500");
    });

    it("parses major amount string or number to integer minor units", () => {
      expect(parseMoneyToMinor("349.99")).toBe(34999);
      expect(parseMoneyToMinor(10.5)).toBe(1050);
      expect(parseMoneyToMinor("500", "JPY")).toBe(500);
    });

    it("allocates amounts using largest-remainder method", () => {
      const split = allocateByPercent(10001, [33.333333333333336, 33.333333333333336, 33.333333333333336]);
      expect(split).toEqual([3334, 3334, 3333]);
      expect(split.reduce((a, b) => a + b, 0)).toBe(10001);
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
