import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyHashSignature } from "./signing.js";
import type { EvidenceEvent, EvidenceEventBody } from "../schemas/evidence.js";

export const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export function computeEventHash(body: EvidenceEventBody): string {
  const content = body.prevHash + canonicalJson(body);
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface ChainVerificationOutcome {
  valid: boolean;
  totalEvents: number;
  lastHash?: string;
  brokenSeq?: number;
  reason?: string;
  error?: string;
}

export function verifyEvidenceChain(
  events: EvidenceEvent[],
  publicKeys?: Record<string, string> | string,
): ChainVerificationOutcome {
  if (events.length === 0) {
    return { valid: true, totalEvents: 0 };
  }

  for (let i = 0; i < events.length; i++) {
    const current = events[i];
    const expectedSeq = i + 1;

    // 1. Check monotonic sequence numbering (catches gaps and reordering)
    if (current.seq !== expectedSeq) {
      const reason = `Sequence error detected at index ${i}: expected seq ${expectedSeq}, got seq ${current.seq}`;
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        reason,
        error: reason,
      };
    }

    // 2. Check previous hash link
    const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : events[i - 1].hash;
    if (current.prevHash !== expectedPrevHash) {
      const reason = `Broken prevHash link at seq ${current.seq}: expected '${expectedPrevHash}', got '${current.prevHash}'`;
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        reason,
        error: reason,
      };
    }

    // 3. Recompute and verify content hash (catches field modifications and payload tampering)
    const body: EvidenceEventBody = {
      id: current.id,
      purchaseId: current.purchaseId,
      seq: current.seq,
      type: current.type,
      actor: current.actor,
      payload: current.payload,
      createdAt: current.createdAt,
      prevHash: current.prevHash,
      signerKeyId: current.signerKeyId,
    };

    const computedHash = computeEventHash(body);
    if (computedHash !== current.hash) {
      const reason = `Hash mismatch at seq ${current.seq}: stored '${current.hash}', recomputed '${computedHash}'`;
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        reason,
        error: reason,
      };
    }

    // 4. Verify Ed25519 signature if public key provided
    if (publicKeys && current.signature) {
      const pubKey = typeof publicKeys === "string" ? publicKeys : publicKeys[current.signerKeyId];
      if (pubKey) {
        const isSigValid = verifyHashSignature(current.hash, current.signature, pubKey);
        if (!isSigValid) {
          const reason = `Invalid Ed25519 signature at seq ${current.seq} for signer '${current.signerKeyId}'`;
          return {
            valid: false,
            totalEvents: events.length,
            brokenSeq: current.seq,
            reason,
            error: reason,
          };
        }
      }
    }
  }

  return {
    valid: true,
    totalEvents: events.length,
    lastHash: events[events.length - 1].hash,
  };
}
