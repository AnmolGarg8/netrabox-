import { randomUUID } from "node:crypto";
import { type LLMAdapter, canTransition } from "@netrabox/core";
import type { IStateStore, PurchaseStateMachineService } from "../state-machine/machine.js";
import type { EvidenceService } from "../evidence/service.js";
import type { PayPalClient } from "../paypal/client.js";
import { PolicyEngine } from "./policy-engine.js";
import { BuyerAdvocateAgent, MerchantAdvocateAgent } from "./advocates.js";
import { ChiefJudgeAgent } from "./judge.js";
import type { DisputeRecord, TribunalRunRecord, TribunalExecutionResult } from "./types.js";

export interface TribunalRunnerOptions {
  store: IStateStore;
  stateMachine: PurchaseStateMachineService;
  evidenceService: EvidenceService;
  paypalClient: PayPalClient;
  llm: LLMAdapter;
  signingPrivateKeyHex: string;
  confidenceThreshold?: number;
}

export class TribunalRunner {
  private store: IStateStore;
  private stateMachine: PurchaseStateMachineService;
  private evidenceService: EvidenceService;
  private paypalClient: PayPalClient;
  private policyEngine: PolicyEngine;
  private buyerAdvocate: BuyerAdvocateAgent;
  private merchantAdvocate: MerchantAdvocateAgent;
  private chiefJudge: ChiefJudgeAgent;
  private signingPrivateKeyHex: string;

  constructor(options: TribunalRunnerOptions) {
    this.store = options.store;
    this.stateMachine = options.stateMachine;
    this.evidenceService = options.evidenceService;
    this.paypalClient = options.paypalClient;
    this.policyEngine = new PolicyEngine(options.confidenceThreshold ?? 0.7);
    this.buyerAdvocate = new BuyerAdvocateAgent(options.llm);
    this.merchantAdvocate = new MerchantAdvocateAgent(options.llm);
    this.chiefJudge = new ChiefJudgeAgent(options.llm);
    this.signingPrivateKeyHex = options.signingPrivateKeyHex;
  }

  /**
   * Executes the full autonomous dispute tribunal workflow
   */
  public async runTribunal(
    dispute: DisputeRecord,
    disputesMap?: Map<string, DisputeRecord>,
    tribunalRunsMap?: Map<string, TribunalRunRecord>,
  ): Promise<TribunalExecutionResult> {
    const purchase = await this.store.getPurchase(dispute.purchaseId);
    if (!purchase) {
      throw new Error(`Purchase '${dispute.purchaseId}' not found for dispute '${dispute.id}'`);
    }

    // Ensure purchase enters DISPUTED state if not already transitioned
    if (purchase.state !== "DISPUTED" && canTransition(purchase.state, "OPEN_DISPUTE")) {
      await this.stateMachine.transition({
        purchaseId: dispute.purchaseId,
        action: "OPEN_DISPUTE",
        actor: dispute.claimantActor,
        payload: {
          disputeId: dispute.id,
          reason: dispute.reason,
          disputedAmountMinor: dispute.disputedAmountMinor,
        },
        signingPrivateKeyHex: this.signingPrivateKeyHex,
      });
    }

    const runId = `tr_${randomUUID()}`;

    // =========================================================================
    // STEP 1: DETERMINISTIC INTEGRITY CHECK (ZERO LLM)
    // =========================================================================
    const verification = await this.evidenceService.verifyChain(dispute.purchaseId);

    if (!verification.valid) {
      const failureReason =
        verification.reason || `Integrity broken at seq #${verification.brokenSeq}`;

      const blockedRun: TribunalRunRecord = {
        id: runId,
        disputeId: dispute.id,
        purchaseId: dispute.purchaseId,
        chainIntegrityValid: false,
        integrityFailureReason: failureReason,
        judgeClassification: "NO_FAULT",
        liabilityBuyer: 0,
        liabilityAgentProvider: 0,
        liabilityMerchant: 0,
        recommendedAction: "ESCALATE_HUMAN",
        confidence: "1.0",
        judgeReasoning: `TRIBUNAL BLOCKED: Cryptographic evidence chain failed verification (${failureReason}). No AI agents invoked. Immediate human review required.`,
        executedAction: "ESCALATE",
        policyEnginePassed: false,
        policyEngineErrors: [failureReason],
        createdAt: new Date(),
      };

      dispute.status = "NEEDS_HUMAN_REVIEW";
      if (disputesMap) disputesMap.set(dispute.id, dispute);
      if (tribunalRunsMap) tribunalRunsMap.set(runId, blockedRun);

      // Transition purchase state to NEEDS_HUMAN_REVIEW
      try {
        await this.stateMachine.transition({
          purchaseId: dispute.purchaseId,
          action: "ESCALATE",
          actor: "tribunal",
          payload: {
            reason: failureReason,
            blockedRunId: runId,
          },
          signingPrivateKeyHex: this.signingPrivateKeyHex,
        });
      } catch (err) {
        console.warn(`State transition to ESCALATE failed:`, err);
      }

      return {
        dispute,
        tribunalRun: blockedRun,
        executedAction: "ESCALATE",
        requiresHumanReview: true,
      };
    }

    // =========================================================================
    // STEP 2: MULTI-AGENT ADVOCATES (Grounding against verified IDs)
    // =========================================================================
    dispute.status = "IN_TRIBUNAL";
    if (disputesMap) disputesMap.set(dispute.id, dispute);

    const events = await this.evidenceService.getEvents(dispute.purchaseId);
    const validEvidenceIds = new Set(events.map((e) => e.id));

    const advocateInput = {
      disputeReason: dispute.reason,
      disputedAmountMinor: dispute.disputedAmountMinor,
      events,
      validEvidenceIds,
    };

    // 2a. Buyer Advocate
    const buyerBrief = await this.buyerAdvocate.generateBrief(advocateInput);
    await this.evidenceService.appendEvent({
      purchaseId: dispute.purchaseId,
      type: "TRIBUNAL_STEP",
      actor: "tribunal",
      payload: { step: "BUYER_ADVOCATE_BRIEF", ...buyerBrief },
      signerKeyId: "tribunal_buyer_advocate",
      signingPrivateKeyHex: this.signingPrivateKeyHex,
    });

    // 2b. Merchant Advocate
    const merchantBrief = await this.merchantAdvocate.generateBrief(advocateInput);
    await this.evidenceService.appendEvent({
      purchaseId: dispute.purchaseId,
      type: "TRIBUNAL_STEP",
      actor: "tribunal",
      payload: { step: "MERCHANT_ADVOCATE_BRIEF", ...merchantBrief },
      signerKeyId: "tribunal_merchant_advocate",
      signingPrivateKeyHex: this.signingPrivateKeyHex,
    });

    // =========================================================================
    // STEP 3: IMPARTIAL CHIEF JUDGE VERDICT
    // =========================================================================
    const verdict = await this.chiefJudge.evaluateDispute({
      disputeReason: dispute.reason,
      disputedAmountMinor: dispute.disputedAmountMinor,
      buyerBrief,
      merchantBrief,
      events,
      validEvidenceIds,
    });

    await this.evidenceService.appendEvent({
      purchaseId: dispute.purchaseId,
      type: "TRIBUNAL_VERDICT",
      actor: "tribunal",
      payload: { ...verdict },
      signerKeyId: "tribunal_chief_judge",
      signingPrivateKeyHex: this.signingPrivateKeyHex,
    });

    // =========================================================================
    // STEP 4: DETERMINISTIC POLICY ENGINE ENFORCEMENT & SETTLEMENT
    // =========================================================================
    const maxAllowedRefund =
      purchase.capturedAmountMinor > 0 ? purchase.capturedAmountMinor : purchase.amountMinor;

    const validation = this.policyEngine.validateVerdict(verdict, {
      validEvidenceIds,
      maxAllowedRefundMinor: maxAllowedRefund,
      purchase,
    });

    let executedActionId: string | undefined;

    if (validation.passed && !validation.requiresHumanReview) {
      try {
        // Execute real settlement action on PayPal
        if (
          (validation.resolvedAction === "RESOLVE_REFUND_FULL" ||
            validation.resolvedAction === "RESOLVE_REFUND_PARTIAL") &&
          purchase.paypalCaptureId
        ) {
          const refundRes = await this.paypalClient.refundCapture(
            purchase.paypalCaptureId,
            dispute.purchaseId,
            {
              amountMinor: validation.sanitizedRefundAmountMinor,
              currency: purchase.currency,
              note: `NetraBox Tribunal Settlement: ${verdict.classification}`,
            },
          );
          executedActionId = refundRes.id;
        } else if (validation.resolvedAction === "RESOLVE_VOID" && purchase.paypalAuthorizationId) {
          const voidRes = await this.paypalClient.voidAuthorization(
            purchase.paypalAuthorizationId,
            dispute.purchaseId,
          );
          executedActionId = voidRes.id;
        }

        // Apply state machine transition atomically with evidence event
        await this.stateMachine.transition({
          purchaseId: dispute.purchaseId,
          action: validation.resolvedAction,
          actor: "system",
          payload: {
            tribunalRunId: runId,
            verdict,
            executedActionId,
            refundAmountMinor: validation.sanitizedRefundAmountMinor,
          },
          signingPrivateKeyHex: this.signingPrivateKeyHex,
          patch: {
            refundedAmountMinor:
              (purchase.refundedAmountMinor || 0) + validation.sanitizedRefundAmountMinor,
          },
        });

        // Record ACTION_EXECUTED in the ledger
        await this.evidenceService.appendEvent({
          purchaseId: dispute.purchaseId,
          type: "ACTION_EXECUTED",
          actor: "system",
          payload: {
            action: validation.resolvedAction,
            executedActionId,
            refundAmountMinor: validation.sanitizedRefundAmountMinor,
            verdictClassification: verdict.classification,
          },
          signerKeyId: "netrabox_policy_engine",
          signingPrivateKeyHex: this.signingPrivateKeyHex,
        });

        dispute.status = "RESOLVED";
        dispute.resolutionState = validation.resolvedAction;
        dispute.resolvedAt = new Date();
      } catch (execErr) {
        console.error("PayPal execution failed during settlement:", execErr);
        dispute.status = "NEEDS_HUMAN_REVIEW";
        validation.requiresHumanReview = true;
        validation.errors.push(
          `PayPal execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
        );
      }
    } else {
      dispute.status = "NEEDS_HUMAN_REVIEW";
      try {
        await this.stateMachine.transition({
          purchaseId: dispute.purchaseId,
          action: "ESCALATE",
          actor: "system",
          payload: {
            reasons: validation.errors,
            verdict,
          },
          signingPrivateKeyHex: this.signingPrivateKeyHex,
        });
      } catch (escalateErr) {
        console.warn("State escalation transition failed:", escalateErr);
      }
    }

    const tribunalRun: TribunalRunRecord = {
      id: runId,
      disputeId: dispute.id,
      purchaseId: dispute.purchaseId,
      chainIntegrityValid: true,
      buyerAdvocateArgument: buyerBrief.argument,
      buyerCitedEvidenceIds: buyerBrief.citedEvidenceIds,
      merchantAdvocateArgument: merchantBrief.argument,
      merchantCitedEvidenceIds: merchantBrief.citedEvidenceIds,
      judgeClassification: verdict.classification,
      liabilityBuyer: verdict.liabilitySplit.buyer,
      liabilityAgentProvider: verdict.liabilitySplit.agentProvider,
      liabilityMerchant: verdict.liabilitySplit.merchant,
      recommendedAction: verdict.recommendedAction,
      recommendedRefundMinor: verdict.refundAmountMinor,
      confidence: verdict.confidence.toString(),
      judgeReasoning: verdict.reasoning,
      executedAction: validation.resolvedAction,
      executedActionId,
      policyEnginePassed: validation.passed,
      policyEngineErrors: validation.errors,
      createdAt: new Date(),
    };

    if (disputesMap) disputesMap.set(dispute.id, dispute);
    if (tribunalRunsMap) tribunalRunsMap.set(runId, tribunalRun);

    return {
      dispute,
      tribunalRun,
      buyerBrief,
      merchantBrief,
      verdict,
      executedAction: validation.resolvedAction,
      requiresHumanReview: validation.requiresHumanReview,
    };
  }
}
