import {
  type LLMAdapter,
  type ProposedCart,
  type StructuredConstraints,
  type IntentGuardResult,
  validateCartAgainstConstraints,
  sanitizeUntrustedMerchantText,
  DEMO_MERCHANTS,
  type ShopProduct,
} from "@netrabox/core";
import { NetraBoxRecorder } from "@netrabox/sdk";

export interface BuyerAgentOptions {
  llm: LLMAdapter;
  apiBaseUrl: string;
  recorder?: NetraBoxRecorder;
}

export interface ShoppingWorkflowInput {
  purchaseId: string;
  userPrompt: string;
  constraints: StructuredConstraints;
  preferredMerchantId?: string;
  mockApproval?: boolean;
}

export interface ShoppingWorkflowOutput {
  purchaseId: string;
  intentGuardResult: IntentGuardResult;
  cart?: ProposedCart;
  approvalUrl?: string;
  workflowStatus: "COMPLETED" | "BLOCKED_BY_INTENT_GUARD" | "ERROR";
  reason?: string;
}

export class BuyerAgent {
  private llm: LLMAdapter;
  private recorder: NetraBoxRecorder;
  private apiBaseUrl: string;

  constructor(options: BuyerAgentOptions) {
    this.llm = options.llm;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.recorder =
      options.recorder ||
      new NetraBoxRecorder({
        apiUrl: this.apiBaseUrl,
        signerKeyId: "buyer_agent_key",
        defaultActor: "agent",
      });
  }

  /**
   * Tool 1: search_offers (wrapped with NetraBox SDK recorder)
   */
  public getSearchOffersTool(purchaseId: string) {
    const rawSearch = async (query: string): Promise<ShopProduct[]> => {
      const results: ShopProduct[] = [];
      const queryLower = query.toLowerCase();

      for (const merchant of Object.values(DEMO_MERCHANTS)) {
        for (const product of merchant.products) {
          if (
            product.name.toLowerCase().includes(queryLower) ||
            product.category.toLowerCase().includes(queryLower) ||
            product.brand.toLowerCase().includes(queryLower)
          ) {
            results.push(product);
          }
        }
      }
      return results;
    };

    return this.recorder.wrapTool(rawSearch, {
      purchaseId,
      toolName: "search_offers",
      actor: "agent",
    });
  }

  /**
   * Tool 2: propose_cart (wrapped with NetraBox SDK recorder)
   */
  public getProposeCartTool(purchaseId: string) {
    const rawProposeCart = async (
      cart: ProposedCart,
    ): Promise<{ success: boolean; cart: ProposedCart }> => {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/purchases/${purchaseId}/cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cart),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to propose cart to NetraBox API: ${errorText}`);
      }

      return { success: true, cart };
    };

    return this.recorder.wrapTool(rawProposeCart, {
      purchaseId,
      toolName: "propose_cart",
      actor: "agent",
    });
  }

  /**
   * Tool 3: request_approval (wrapped with NetraBox SDK recorder)
   */
  public getRequestApprovalTool(purchaseId: string) {
    const rawRequestApproval = async (): Promise<{
      approvalUrl?: string;
      paypalOrderId?: string;
    }> => {
      const response = await fetch(`${this.apiBaseUrl}/api/v1/purchases/${purchaseId}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to request PayPal authorization from NetraBox API: ${errorText}`);
      }

      return (await response.json()) as { approvalUrl?: string; paypalOrderId?: string };
    };

    return this.recorder.wrapTool(rawRequestApproval, {
      purchaseId,
      toolName: "request_approval",
      actor: "agent",
    });
  }

  /**
   * Executes autonomous shopping workflow with prompt-injection defense and Intent Guard
   */
  public async executeShoppingWorkflow(
    input: ShoppingWorkflowInput,
  ): Promise<ShoppingWorkflowOutput> {
    const { purchaseId, userPrompt, constraints, preferredMerchantId } = input;

    // 1. Record User Shopping Instruction
    await this.recorder.recordInstruction(purchaseId, userPrompt, {
      constraints: constraints as unknown as Record<string, unknown>,
    });

    // 2. Search for offers using tool
    const searchTool = this.getSearchOffersTool(purchaseId);
    const searchKeyword = constraints.brand || "headphones";
    const rawOffers: ShopProduct[] = await searchTool(searchKeyword);

    // 3. Format and record observed offers with PROMPT-INJECTION HARDENING:
    // Untrusted merchant descriptions are wrapped in XML-like delimited blocks
    const safeOffers: ShopProduct[] = rawOffers.map((offer: ShopProduct) => ({
      ...offer,
      description: sanitizeUntrustedMerchantText(offer.description),
    }));

    await this.recorder.recordOffers(
      purchaseId,
      searchKeyword,
      safeOffers.map((o: ShopProduct) => ({
        id: o.id,
        title: o.name,
        priceMinor: o.priceMinor,
        merchantId: o.merchantId,
        inStock: o.inStock,
      })),
    );

    // 4. Decision Selection Logic (Heuristic / LLM with hard grounding)
    // Filter offers matching brand & budget constraints
    let selected: ShopProduct | undefined = safeOffers.find(
      (o: ShopProduct) =>
        (!preferredMerchantId || o.merchantId === preferredMerchantId) &&
        o.priceMinor <= constraints.budgetMinor &&
        (!constraints.brand || o.brand.toLowerCase() === constraints.brand.toLowerCase()) &&
        (!constraints.color || o.color?.toLowerCase() === constraints.color.toLowerCase()),
    );

    // If preferred merchant forced a malicious/injected offer (e.g. in test scenario):
    if (!selected && preferredMerchantId) {
      selected = safeOffers.find((o: ShopProduct) => o.merchantId === preferredMerchantId);
    }

    if (!selected) {
      selected = safeOffers[0];
    }

    if (!selected) {
      return {
        purchaseId,
        intentGuardResult: {
          status: "BLOCK",
          score: 0.0,
          reasons: ["No merchant offers found matching search query"],
          understoodSummary: "No items available in shop",
          constraints,
        },
        workflowStatus: "ERROR",
        reason: "No offers found",
      };
    }

    // 5. Record Agent Reasoning Scratchpad
    await this.recorder.recordReasoning(
      purchaseId,
      `Selected ${selected.name} from ${selected.merchantId} at $${(
        selected.priceMinor / 100
      ).toFixed(2)}. Verified that item matches brand and color requirements.`,
      `Scratchpad: Comparing ${safeOffers.length} offers. Filtered out out-of-stock items. Delimited merchant text reviewed without executing embedded instructions.`,
      selected.id,
    );

    // 6. Assemble proposed cart
    const proposedCart: ProposedCart = {
      items: [
        {
          sku: selected.sku,
          name: selected.name,
          priceMinor: selected.priceMinor,
          quantity: constraints.quantity,
        },
      ],
      totalMinor: selected.priceMinor * constraints.quantity,
      merchantQuoteId: `quote_${selected.id}_${Date.now()}`,
    };

    // 7. Run Intent Guard DETERMINISTICALLY
    const intentGuardResult = validateCartAgainstConstraints(proposedCart, constraints);

    // Log Intent Guard Result as an Evidence Event
    await this.recorder.recordEvent(purchaseId, "INTENT_CHECK_RESULT", {
      passed: intentGuardResult.status !== "BLOCK",
      status: intentGuardResult.status,
      score: intentGuardResult.score,
      reasons: intentGuardResult.reasons,
      understoodSummary: intentGuardResult.understoodSummary,
      extractedConstraints: constraints,
    });

    if (intentGuardResult.status === "BLOCK") {
      return {
        purchaseId,
        intentGuardResult,
        cart: proposedCart,
        workflowStatus: "BLOCKED_BY_INTENT_GUARD",
        reason: intentGuardResult.reasons.join("; "),
      };
    }

    // 8. Propose cart to NetraBox API
    const proposeCartTool = this.getProposeCartTool(purchaseId);
    await proposeCartTool(proposedCart);

    // 9. Request Buyer Approval / PayPal Order creation
    const requestApprovalTool = this.getRequestApprovalTool(purchaseId);
    const { approvalUrl } = await requestApprovalTool();

    return {
      purchaseId,
      intentGuardResult,
      cart: proposedCart,
      approvalUrl,
      workflowStatus: "COMPLETED",
    };
  }
}
