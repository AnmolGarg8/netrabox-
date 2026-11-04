import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
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
  error?: string;
}

export function verifyEvidenceChain(events: EvidenceEvent[]): ChainVerificationOutcome {
  if (events.length === 0) {
    return { valid: true, totalEvents: 0 };
  }

  for (let i = 0; i < events.length; i++) {
    const current = events[i];
    const expectedSeq = i + 1;

    // Check monotonic sequence numbering
    if (current.seq !== expectedSeq) {
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        error: `Sequence gap detected: expected ${expectedSeq}, got ${current.seq}`,
      };
    }

    // Check previous hash link
    const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : events[i - 1].hash;
    if (current.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        error: `Broken prevHash link at seq ${current.seq}: expected '${expectedPrevHash}', got '${current.prevHash}'`,
      };
    }

    // Recompute and verify content hash
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
      return {
        valid: false,
        totalEvents: events.length,
        brokenSeq: current.seq,
        error: `Hash mismatch at seq ${current.seq}: stored '${current.hash}', recomputed '${computedHash}'`,
      };
    }
  }

  return {
    valid: true,
    totalEvents: events.length,
    lastHash: events[events.length - 1].hash,
  };
}
