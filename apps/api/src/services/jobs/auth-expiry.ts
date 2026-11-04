import type { PayPalClient } from "../paypal/client.js";
import type { PurchaseStateMachineService } from "../state-machine/machine.js";
import type { PurchaseRecord } from "../state-machine/types.js";

export interface AuthExpiryJobOptions {
  warningThresholdHours?: number; // e.g. flag if within 48h of 29 days
  autoVoidCloseToExpiry?: boolean; // automatically void authorizations nearing cutoff
  honorPeriodDays?: number; // default: 3 days
  maxValidityDays?: number; // default: 29 days (PayPal standard)
  signingPrivateKeyHex: string;
}

export interface AuthExpiryScanResult {
  scannedCount: number;
  flaggedCount: number;
  voidedCount: number;
  flaggedPurchaseIds: string[];
  voidedPurchaseIds: string[];
}

export class AuthExpiryMonitorJob {
  private paypalClient: PayPalClient;
  private stateMachine: PurchaseStateMachineService;
  private options: Required<AuthExpiryJobOptions>;

  constructor(
    paypalClient: PayPalClient,
    stateMachine: PurchaseStateMachineService,
    options: AuthExpiryJobOptions,
  ) {
    this.paypalClient = paypalClient;
    this.stateMachine = stateMachine;
    this.options = {
      warningThresholdHours: options.warningThresholdHours ?? 48,
      autoVoidCloseToExpiry: options.autoVoidCloseToExpiry ?? false,
      honorPeriodDays: options.honorPeriodDays ?? 3,
      maxValidityDays: options.maxValidityDays ?? 29,
      signingPrivateKeyHex: options.signingPrivateKeyHex,
    };
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
            await this.paypalClient.voidAuthorization(purchase.paypalAuthorizationId, purchase.id);

            await this.stateMachine.transition({
              purchaseId: purchase.id,
              action: "VOID_ORDER",
              actor: "system",
              payload: {
                reason: "Auto-voided by AuthExpiryMonitorJob before 29-day cutoff",
                msRemaining,
              },
              signingPrivateKeyHex: this.options.signingPrivateKeyHex,
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
