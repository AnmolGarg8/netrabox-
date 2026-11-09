import type { AppendEvidenceInput, EvidenceActor, EvidenceEventType } from "@netrabox/core";

export interface NetraBoxClientOptions {
  apiUrl: string;
  signerKeyId?: string;
  defaultActor?: EvidenceActor;
}

export interface WrapToolOptions {
  purchaseId: string;
  actor?: EvidenceActor;
  toolName?: string;
}

export class NetraBoxRecorder {
  private apiUrl: string;
  private signerKeyId: string;
  private defaultActor: EvidenceActor;

  constructor(options: NetraBoxClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.signerKeyId = options.signerKeyId || "agent_recorder_key";
    this.defaultActor = options.defaultActor || "agent";
  }

  /**
   * Raw evidence append helper
   */
  public async recordEvent(
    purchaseId: string,
    type: EvidenceEventType,
    payload: Record<string, unknown>,
    actor?: EvidenceActor,
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/purchases/${purchaseId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          actor: actor || this.defaultActor,
          payload,
          signerKeyId: this.signerKeyId,
        } satisfies AppendEvidenceInput),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = (await response.json()) as { id?: string };
      return { success: true, eventId: data.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 1. Helper: Record User Prompt / Instructions
   */
  public async recordInstruction(
    purchaseId: string,
    prompt: string,
    options?: { constraints?: Record<string, unknown>; buyerId?: string },
  ) {
    return await this.recordEvent(
      purchaseId,
      "INSTRUCTION_RECEIVED",
      {
        prompt,
        constraints: options?.constraints,
        buyerId: options?.buyerId,
      },
      "user",
    );
  }

  /**
   * 1b. Helper: Record Structured Constraints Extracted from Instruction
   */
  public async recordConstraints(
    purchaseId: string,
    hardConstraints: Record<string, unknown>,
    options?: { softPreferences?: Record<string, unknown>; ambiguousFields?: string[] },
  ) {
    return await this.recordEvent(
      purchaseId,
      "CONSTRAINTS_EXTRACTED",
      {
        hardConstraints,
        softPreferences: options?.softPreferences,
        ambiguousFields: options?.ambiguousFields,
      },
      "system",
    );
  }

  /**
   * 1c. Helper: Record User Confirmation / Approval
   */
  public async recordApproval(
    purchaseId: string,
    approved: boolean,
    options?: { userNotes?: string; reason?: string },
  ) {
    return await this.recordEvent(
      purchaseId,
      "USER_APPROVAL",
      {
        approved,
        approvedAt: new Date().toISOString(),
        userNotes: options?.userNotes,
        reason: options?.reason,
      },
      "user",
    );
  }

  /**
   * 2. Helper: Record Observed Product Offers
   */
  public async recordOffers(
    purchaseId: string,
    query: string,
    offers: Array<{
      title: string;
      priceMinor: number;
      merchantId: string;
      id?: string;
      url?: string;
      inStock?: boolean;
    }>,
  ) {
    return await this.recordEvent(purchaseId, "OFFERS_OBSERVED", {
      query,
      offers,
    });
  }

  /**
   * 3. Helper: Record Agent Scratchpad & Decision Rationale
   */
  public async recordReasoning(
    purchaseId: string,
    rationale: string,
    scratchpad?: string,
    selectedOfferId?: string,
  ) {
    return await this.recordEvent(purchaseId, "AGENT_REASONING", {
      rationale,
      scratchpad,
      selectedOfferId,
    });
  }

  /**
   * 4. Helper: Record Proposed Cart Prior to Checkout
   */
  public async recordCart(
    purchaseId: string,
    cart: {
      items: Array<{ sku: string; name: string; priceMinor: number; quantity: number }>;
      totalMinor: number;
      merchantQuoteId: string;
    },
  ) {
    return await this.recordEvent(purchaseId, "CART_PROPOSED", cart);
  }

  /**
   * 5. Tool Wrapper: Wraps any async tool, measuring execution time and logging input/output/errors
   */
  public wrapTool<TArgs extends unknown[], TReturn>(
    toolFn: (...args: TArgs) => Promise<TReturn> | TReturn,
    options: WrapToolOptions,
  ): (...args: TArgs) => Promise<TReturn> {
    const toolName = options.toolName || toolFn.name || "anonymous_tool";
    const actor = options.actor || this.defaultActor;

    return async (...args: TArgs): Promise<TReturn> => {
      const startTime = Date.now();
      let output: unknown = undefined;
      let errorMsg: string | undefined = undefined;

      try {
        const result = await toolFn(...args);
        output = result;
        return result;
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const durationMs = Date.now() - startTime;

        // Log tool execution evidence asynchronously (fire & log without blocking main flow)
        this.recordEvent(
          options.purchaseId,
          "ACTION_EXECUTED",
          {
            action: `TOOL_EXECUTION:${toolName}`,
            toolName,
            input: args,
            output: output ?? null,
            error: errorMsg ?? null,
            durationMs,
            executedAt: new Date().toISOString(),
          },
          actor,
        ).catch((logErr) => {
          console.error(`Failed to record tool evidence for ${toolName}:`, logErr);
        });
      }
    };
  }
}
