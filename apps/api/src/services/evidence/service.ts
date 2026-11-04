import { randomUUID } from "node:crypto";
import {
  computeEventHash,
  signHash,
  verifyEvidenceChain,
  computeMerkleRoot,
  GENESIS_PREV_HASH,
  type EvidenceEvent,
  type EvidenceEventBody,
  type EvidenceEventType,
  type EvidenceActor,
  type ChainVerificationOutcome,
} from "@netrabox/core";
import type { IStateStore } from "../state-machine/machine.js";

export interface AppendEventParams {
  purchaseId: string;
  type: EvidenceEventType;
  actor: EvidenceActor;
  payload: Record<string, unknown>;
  signerKeyId?: string;
  signingPrivateKeyHex?: string;
}

export interface DetailedVerificationReport extends ChainVerificationOutcome {
  purchaseId: string;
  merkleRoot: string;
  verifiedAt: string;
}

export interface EvidencePack {
  version: "1.0.0";
  purchaseId: string;
  totalEvents: number;
  valid: boolean;
  merkleRoot: string;
  publicKeyHex?: string;
  exportedAt: string;
  events: EvidenceEvent[];
}

export class EvidenceService {
  private store: IStateStore;
  private defaultPrivateKeyHex: string;
  private defaultPublicKeyHex?: string;

  // Mutex per purchaseId to guarantee serial non-forking execution during concurrent appends
  private appendQueues: Map<string, Promise<unknown>> = new Map();

  constructor(store: IStateStore, defaultPrivateKeyHex: string, defaultPublicKeyHex?: string) {
    this.store = store;
    this.defaultPrivateKeyHex = defaultPrivateKeyHex;
    this.defaultPublicKeyHex = defaultPublicKeyHex;
  }

  /**
   * Appends an evidence event with strict concurrency locking to ensure no gaps or forks
   */
  public async appendEvent(params: AppendEventParams): Promise<EvidenceEvent> {
    const queue = this.appendQueues.get(params.purchaseId) || Promise.resolve();

    const execution = queue.then(async () => {
      const purchase = await this.store.getPurchase(params.purchaseId);
      if (!purchase) {
        throw new Error(`Purchase '${params.purchaseId}' not found.`);
      }

      const lastEvent = await this.store.getLastEvidenceEvent(params.purchaseId);
      const nextSeq = lastEvent ? lastEvent.seq + 1 : 1;
      const prevHash = lastEvent ? lastEvent.hash : GENESIS_PREV_HASH;

      const eventId = `ev_${randomUUID()}`;
      const createdAt = new Date().toISOString();
      const privKey = params.signingPrivateKeyHex || this.defaultPrivateKeyHex;

      const body: EvidenceEventBody = {
        id: eventId,
        purchaseId: params.purchaseId,
        seq: nextSeq,
        type: params.type,
        actor: params.actor,
        payload: params.payload,
        createdAt,
        prevHash,
        signerKeyId: params.signerKeyId || "netrabox_system_key",
      };

      const hash = computeEventHash(body);
      const signature = signHash(hash, privKey);

      const event: EvidenceEvent = {
        ...body,
        hash,
        signature,
      };

      // Persist event atomically via store
      await this.store.applyAtomicTransition(params.purchaseId, purchase.state, {}, event);

      return event;
    });

    this.appendQueues.set(
      params.purchaseId,
      execution.catch(() => {}),
    );

    return await execution;
  }

  /**
   * Retrieves full chronological evidence chain for a purchase
   */
  public async getEvents(purchaseId: string): Promise<EvidenceEvent[]> {
    return await this.store.getEvidenceEvents(purchaseId);
  }

  /**
   * Runs complete deterministic chain verification and returns a detailed report
   */
  public async verifyChain(
    purchaseId: string,
    publicKeys?: Record<string, string> | string,
  ): Promise<DetailedVerificationReport> {
    const events = await this.getEvents(purchaseId);
    const keys = publicKeys || this.defaultPublicKeyHex;

    const outcome = verifyEvidenceChain(events, keys);
    const leafHashes = events.map((e) => e.hash);
    const merkleRoot = computeMerkleRoot(leafHashes);

    return {
      purchaseId,
      valid: outcome.valid,
      totalEvents: outcome.totalEvents,
      lastHash: outcome.lastHash,
      brokenSeq: outcome.brokenSeq,
      reason: outcome.reason,
      merkleRoot,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Builds an exportable Evidence Pack bundle
   */
  public async getEvidencePack(purchaseId: string, publicKeyHex?: string): Promise<EvidencePack> {
    const pubKey = publicKeyHex || this.defaultPublicKeyHex;
    const verification = await this.verifyChain(purchaseId, pubKey);
    const events = await this.getEvents(purchaseId);

    return {
      version: "1.0.0",
      purchaseId,
      totalEvents: events.length,
      valid: verification.valid,
      merkleRoot: verification.merkleRoot,
      publicKeyHex: pubKey,
      exportedAt: new Date().toISOString(),
      events,
    };
  }

  /**
   * Silently alters one stored event payload without recalculating hash/signature (Demo Tamper)
   */
  public async tamperEvent(
    purchaseId: string,
    targetSeq: number,
    tamperedPayload: Record<string, unknown>,
  ): Promise<{ success: boolean; tamperedSeq: number }> {
    if (this.store.tamperEvidenceEvent) {
      const ok = await this.store.tamperEvidenceEvent(purchaseId, targetSeq, tamperedPayload);
      if (!ok) {
        throw new Error(`Event with sequence #${targetSeq} not found for purchase '${purchaseId}'`);
      }
      return { success: true, tamperedSeq: targetSeq };
    }

    const events = await this.getEvents(purchaseId);
    const target = events.find((e) => e.seq === targetSeq);

    if (!target) {
      throw new Error(`Event with sequence #${targetSeq} not found for purchase '${purchaseId}'`);
    }

    target.payload = { ...tamperedPayload };
    return { success: true, tamperedSeq: targetSeq };
  }
}
