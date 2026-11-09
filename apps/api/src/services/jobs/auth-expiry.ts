import type { SettlementService } from "../settlement/service.js";
import type { PurchaseRecord } from "../state-machine/types.js";
import type { IStateStore } from "../state-machine/machine.js";

export interface AuthExpiryJobOptions {
  warningThresholdHours?: number; // e.g. flag if within 48h of 29 days
  autoVoidCloseToExpiry?: boolean; // automatically void authorizations nearing cutoff
  honorPeriodDays?: number; // default: 3 days
  maxValidityDays?: number; // default: 29 days (PayPal standard)
  signingPrivateKeyHex?: string;
}

export interface AuthExpiryScanResult {
  scannedCount: number;
  flaggedCount: number;
  voidedCount: number;
  flaggedPurchaseIds: string[];
  voidedPurchaseIds: string[];
}

export class AuthExpiryMonitorJob {
  private settlementService: SettlementService;
  private options: Required<AuthExpiryJobOptions>;
  private isRunning = false;

  constructor(settlementService: SettlementService, options: AuthExpiryJobOptions = {}) {
    this.settlementService = settlementService;
    this.options = {
      warningThresholdHours: options.warningThresholdHours ?? 48,
      autoVoidCloseToExpiry: options.autoVoidCloseToExpiry ?? false,
      honorPeriodDays: options.honorPeriodDays ?? 3,
      maxValidityDays: options.maxValidityDays ?? 29,
      signingPrivateKeyHex: options.signingPrivateKeyHex || "",
    };
  }

  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Runs the scan against active AUTHORIZED purchases in store with guard against overlapping runs
   */
  public async runScan(
    store: IStateStore,
  ): Promise<{ status: "ok" | "skipped_in_progress"; result?: AuthExpiryScanResult }> {
    if (this.isRunning) {
      return { status: "skipped_in_progress" };
    }
    this.isRunning = true;
    try {
      const authorizedPurchases = store.listPurchases
        ? await store.listPurchases({ state: "AUTHORIZED" })
        : [];
      const result = await this.scanAuthorizations(authorizedPurchases);
      return { status: "ok", result };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Scans a list of active authorized purchases and checks their expiration status
   */
  public async scanAuthorizations(
    authorizedPurchases: PurchaseRecord[],
  ): Promise<AuthExpiryScanResult> {
    const result: AuthExpiryScanResult = {
      scannedCount: authorizedPurchases.length,
      flaggedCount: 0,
      voidedCount: 0,
      flaggedPurchaseIds: [],
      voidedPurchaseIds: [],
    };

    const now = Date.now();
    const maxValidityMs = this.options.maxValidityDays * 24 * 60 * 60 * 1000;
    const warningMs = this.options.warningThresholdHours * 60 * 60 * 1000;

    for (const purchase of authorizedPurchases) {
      if (purchase.state !== "AUTHORIZED" || !purchase.paypalAuthorizationId) {
        continue;
      }

      const authCreatedAt = new Date(purchase.updatedAt || purchase.createdAt).getTime();
      const expiresAt = authCreatedAt + maxValidityMs;
      const msRemaining = expiresAt - now;

      // Close to expiry
      if (msRemaining <= warningMs) {
        result.flaggedCount++;
        result.flaggedPurchaseIds.push(purchase.id);

        if (this.options.autoVoidCloseToExpiry && msRemaining > 0) {
          try {
            await this.settlementService.execute({
              purchaseId: purchase.id,
              kind: "VOID",
              amountMinor: 0,
              currency: purchase.currency,
              requestedBy: "job",
              reason: "Auto-voided by AuthExpiryMonitorJob before 29-day cutoff",
            });

            result.voidedCount++;
            result.voidedPurchaseIds.push(purchase.id);
          } catch (voidErr) {
            console.error(`Failed to auto-void purchase ${purchase.id}:`, voidErr);
          }
        }
      }
    }

    return result;
  }
}
