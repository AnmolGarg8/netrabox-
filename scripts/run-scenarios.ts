import { existsSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import {
  validateCartAgainstConstraints,
  extractConstraints,
  HONEST_MERCHANT,
  MALICIOUS_MERCHANT,
  type ProposedCart,
  type StructuredConstraints,
} from "../packages/core/src/index.js";
import { PurchaseStateMachineService } from "../apps/api/src/services/state-machine/machine.js";
import { InMemoryStateStore } from "../apps/api/src/services/state-machine/in-memory-store.js";
import { EvidenceService } from "../apps/api/src/services/evidence/service.js";
import type { PurchaseRecord } from "../apps/api/src/services/state-machine/types.js";

// Load .env if present
if (existsSync(".env") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Ignore
  }
}

export interface ScenarioRunResult {
  scenarioName: string;
  success: boolean;
  purchaseId: string;
  finalState: string;
  intentGuardStatus: "PASS" | "WARN" | "BLOCK";
  details: string;
}

export async function runScenario(
  scenarioName: string,
  mockApproval = true,
): Promise<ScenarioRunResult> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const pubKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  const store = new InMemoryStateStore();
  const stateMachine = new PurchaseStateMachineService(store);
  const evidenceService = new EvidenceService(store, privKeyHex, pubKeyHex);

  const purchaseId = `pur_scen_${scenarioName}_${Date.now()}`;

  console.log(`\n==================================================================`);
  console.log(`  RUNNING SCENARIO: ${scenarioName.toUpperCase()}`);
  console.log(`==================================================================`);

  const knownScenarios = ["honest-purchase", "wrongsize-delivered", "injection-attempt", "false-claim"];
  if (!knownScenarios.includes(scenarioName) || scenarioName === "plain-sentence") {
    const rawUserPrompt =
      scenarioName === "plain-sentence"
        ? "Buy Sony XM5 wireless headphones under $360"
        : scenarioName;

    console.log(`[Natural Language Prompt]: "${rawUserPrompt}"`);
    console.log(`[Step 1] Extracting structured constraints via Intent Guard extractor...`);
    let constraints = await extractConstraints(rawUserPrompt);
    console.log(`[Extracted Constraints]:`, JSON.stringify(constraints, null, 2));

    // 1. Initialize Purchase in DRAFT
    const purchase: PurchaseRecord = {
      id: purchaseId,
      buyerId: "user_shopper",
      agentId: "agent_gemini_shopper",
      merchantId: HONEST_MERCHANT.id,
      title: constraints.itemDescription || "Online Purchase",
      state: "DRAFT",
      currency: constraints.currency || "USD",
      amountMinor: constraints.budgetMinor || 34999,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set(purchaseId, purchase);

    // 2. Record INSTRUCTION_RECEIVED evidence before search
    await evidenceService.appendEvent({
      purchaseId,
      type: "INSTRUCTION_RECEIVED",
      actor: "user",
      payload: { prompt: rawUserPrompt, buyerId: "user_shopper" },
      signingPrivateKeyHex: privKeyHex,
    });

    // 3. Record CONSTRAINTS_EXTRACTED evidence before search
    await evidenceService.appendEvent({
      purchaseId,
      type: "CONSTRAINTS_EXTRACTED",
      actor: "system",
      payload: {
        hardConstraints: constraints as unknown as Record<string, unknown>,
        ambiguousFields: constraints.ambiguousFields,
      },
      signingPrivateKeyHex: privKeyHex,
    });

    // 4. Check Ambiguity: if any key field is ambiguous, confirm or correct
    const isBudgetMissing = constraints.budgetMinor === undefined || constraints.budgetMinor <= 0;
    const isAmbiguous =
      (constraints.ambiguousFields && constraints.ambiguousFields.length > 0) || isBudgetMissing;
    if (isAmbiguous) {
      console.log(`[Step 1b] Ambiguous fields detected: ${constraints.ambiguousFields.join(", ") || "budget"}`);
      if (mockApproval) {
        console.log(`[Step 1b] Buyer confirms extracted constraints with budget fallback ($360.00)`);
        constraints = {
          ...constraints,
          budgetMinor: constraints.budgetMinor || 36000,
          ambiguousFields: [],
        };
        await evidenceService.appendEvent({
          purchaseId,
          type: "USER_APPROVAL",
          actor: "user",
          payload: { approved: true, userNotes: "User confirmed constraints with budget ceiling" },
          signingPrivateKeyHex: privKeyHex,
        });
      } else {
        await evidenceService.appendEvent({
          purchaseId,
          type: "USER_APPROVAL",
          actor: "user",
          payload: { approved: false, reason: "Ambiguous constraints rejected" },
          signingPrivateKeyHex: privKeyHex,
        });
        return {
          scenarioName,
          success: false,
          purchaseId,
          finalState: "DRAFT",
          intentGuardStatus: "BLOCK",
          details: "Execution halted: Ambiguous constraints not confirmed by user.",
        };
      }
    }

    // 5. Select product from shop & assemble cart
    const matchedProduct =
      HONEST_MERCHANT.products.find(
        (p) =>
          (!constraints.brand || p.brand.toLowerCase() === constraints.brand.toLowerCase()) &&
          (!constraints.color || p.color?.toLowerCase() === constraints.color.toLowerCase()),
      ) || HONEST_MERCHANT.products[0];

    const cart: ProposedCart = {
      items: [
        {
          sku: matchedProduct.sku,
          name: matchedProduct.name,
          priceMinor: matchedProduct.priceMinor,
          quantity: constraints.quantity || 1,
        },
      ],
      currency: constraints.currency || "USD",
      totalMinor: matchedProduct.priceMinor * (constraints.quantity || 1),
      merchantQuoteId: `quote_${matchedProduct.id}_${Date.now()}`,
    };

    console.log(`[Step 2] Assembled proposed cart: ${cart.items[0].name} ($${(cart.totalMinor! / 100).toFixed(2)})`);
    console.log(`[Step 3] Running Intent Guard deterministic verification...`);
    const intentCheck = validateCartAgainstConstraints(cart, constraints);
    console.log(`[Intent Guard] Status: ${intentCheck.status} (Score: ${intentCheck.score})`);

    await evidenceService.appendEvent({
      purchaseId,
      type: "INTENT_CHECK_RESULT",
      actor: "system",
      payload: {
        passed: intentCheck.status !== "BLOCK",
        score: intentCheck.score,
        reason: intentCheck.reasons.join("; "),
        extractedConstraints: constraints as unknown as Record<string, unknown>,
      },
      signingPrivateKeyHex: privKeyHex,
    });

    if (intentCheck.status === "BLOCK") {
      await stateMachine.transition({
        purchaseId,
        action: "FAIL_INTENT_CHECK",
        actor: "system",
        payload: { intentCheck },
        signingPrivateKeyHex: privKeyHex,
      });

      return {
        scenarioName,
        success: false,
        purchaseId,
        finalState: store.purchases.get(purchaseId)!.state,
        intentGuardStatus: "BLOCK",
        details: `Intent Guard blocked purchase: ${intentCheck.reasons.join(", ")}`,
      };
    }

    await stateMachine.transition({
      purchaseId,
      action: "PASS_INTENT_CHECK",
      actor: "system",
      payload: { intentCheck },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { cart },
      signingPrivateKeyHex: privKeyHex,
    });

    if (mockApproval) {
      console.log(`[Step 4] MOCK_APPROVAL: Simulating PayPal sandbox buyer authorization`);
      await stateMachine.transition({
        purchaseId,
        action: "APPROVE_AND_AUTHORIZE",
        actor: "user",
        payload: { authorizationId: `AUTH_${Date.now()}` },
        signingPrivateKeyHex: privKeyHex,
        patch: { paypalAuthorizationId: `AUTH_${Date.now()}` },
      });

      console.log(`[Step 5] Merchant fulfillment: On-time delivery recorded`);
      await stateMachine.transition({
        purchaseId,
        action: "RECORD_DELIVERY",
        actor: "merchant",
        payload: { trackingNumber: `TRK_${Date.now()}`, carrier: "UPS" },
        signingPrivateKeyHex: privKeyHex,
      });

      console.log(`[Step 6] PayPal settlement: Full capture executed`);
      await stateMachine.transition({
        purchaseId,
        action: "CAPTURE_PAYMENT",
        actor: "system",
        payload: { captureId: `CAP_${Date.now()}` },
        signingPrivateKeyHex: privKeyHex,
        patch: { capturedAmountMinor: cart.totalMinor },
      });
    }

    const verify = await evidenceService.verifyChain(purchaseId, pubKeyHex);
    console.log(
      `[Audit] Cryptographic Chain Verification: ${verify.valid ? "PASSED ✅" : "FAILED ❌"}`,
    );

    return {
      scenarioName,
      success: verify.valid && store.purchases.get(purchaseId)?.state === "CAPTURED",
      purchaseId,
      finalState: store.purchases.get(purchaseId)!.state,
      intentGuardStatus: intentCheck.status,
      details: "Completed plain sentence shopping flow with Intent Guard extractor.",
    };
  }

  if (scenarioName === "honest-purchase") {
    // 1. Initialize Purchase
    const purchase: PurchaseRecord = {
      id: purchaseId,
      buyerId: "user_alice",
      agentId: "agent_gemini_shopper",
      merchantId: HONEST_MERCHANT.id,
      title: "Sony WH-1000XM5 Headphones",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 34999,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set(purchaseId, purchase);

    // 2. Constraints & Intent Guard
    const constraints: StructuredConstraints = {
      budgetMinor: 36000, // $360.00
      brand: "Sony",
      color: "black",
      quantity: 1,
      mustHaves: ["noise canceling"],
      forbidden: ["refurbished"],
    };

    const cart: ProposedCart = {
      items: [
        {
          sku: HONEST_MERCHANT.products[0].sku,
          name: HONEST_MERCHANT.products[0].name,
          priceMinor: HONEST_MERCHANT.products[0].priceMinor,
          quantity: 1,
        },
      ],
      totalMinor: HONEST_MERCHANT.products[0].priceMinor,
      merchantQuoteId: "quote_honest_01",
    };

    const intentCheck = validateCartAgainstConstraints(cart, constraints);
    console.log(`[Step 1] Intent Guard: ${intentCheck.status} (Score: ${intentCheck.score})`);

    await stateMachine.transition({
      purchaseId,
      action: "PASS_INTENT_CHECK",
      actor: "system",
      payload: { intentCheck },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { cart },
      signingPrivateKeyHex: privKeyHex,
    });

    if (mockApproval) {
      console.log(`[Step 2] MOCK_APPROVAL: Simulating PayPal sandbox buyer authorization`);
      await stateMachine.transition({
        purchaseId,
        action: "APPROVE_AND_AUTHORIZE",
        actor: "user",
        payload: { authorizationId: "AUTH_MOCK_HONEST_123" },
        signingPrivateKeyHex: privKeyHex,
        patch: { paypalAuthorizationId: "AUTH_MOCK_HONEST_123" },
      });
    }

    console.log(`[Step 3] Merchant fulfillment: On-time delivery recorded`);
    await stateMachine.transition({
      purchaseId,
      action: "RECORD_DELIVERY",
      actor: "merchant",
      payload: { trackingNumber: "TRK_HONEST_8899", carrier: "UPS" },
      signingPrivateKeyHex: privKeyHex,
    });

    console.log(`[Step 4] PayPal settlement: Full capture executed ($349.99 USD)`);
    await stateMachine.transition({
      purchaseId,
      action: "CAPTURE_PAYMENT",
      actor: "system",
      payload: { captureId: "CAP_HONEST_8899" },
      signingPrivateKeyHex: privKeyHex,
      patch: { capturedAmountMinor: 34999 },
    });

    const verify = await evidenceService.verifyChain(purchaseId, pubKeyHex);
    console.log(
      `[Audit] Cryptographic Chain Verification: ${verify.valid ? "PASSED ✅" : "FAILED ❌"}`,
    );

    return {
      scenarioName,
      success: verify.valid && store.purchases.get(purchaseId)?.state === "CAPTURED",
      purchaseId,
      finalState: store.purchases.get(purchaseId)!.state,
      intentGuardStatus: intentCheck.status,
      details: "Completed full purchase lifecycle from prompt to settlement.",
    };
  }

  if (scenarioName === "wrongsize-delivered") {
    const purchase: PurchaseRecord = {
      id: purchaseId,
      buyerId: "user_bob",
      agentId: "agent_gemini_shopper",
      merchantId: MALICIOUS_MERCHANT.id,
      title: "Oxford Button-Down Shirt",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 4500,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set(purchaseId, purchase);

    // Buyer requested Size L
    await stateMachine.transition({
      purchaseId,
      action: "PASS_INTENT_CHECK",
      actor: "system",
      payload: { requestedSize: "L" },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { sku: "APX-SHIRT-LG" },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "APPROVE_AND_AUTHORIZE",
      actor: "user",
      payload: { authId: "AUTH_SIZE_ERR" },
      signingPrivateKeyHex: privKeyHex,
      patch: { paypalAuthorizationId: "AUTH_SIZE_ERR" },
    });

    // Merchant delivered Size S instead!
    console.log(`[Step] Sloppy Merchant shipped Size S instead of requested Size L`);
    await stateMachine.transition({
      purchaseId,
      action: "RECORD_DELIVERY",
      actor: "merchant",
      payload: { deliveredSku: "APX-SHIRT-SM", deliveredSize: "S" },
      signingPrivateKeyHex: privKeyHex,
    });

    // Buyer opens dispute
    console.log(`[Step] Buyer received wrong size and opened formal dispute`);
    await stateMachine.transition({
      purchaseId,
      action: "OPEN_DISPUTE",
      actor: "user",
      payload: { reason: "Merchant shipped Size S instead of Size L ordered" },
      signingPrivateKeyHex: privKeyHex,
    });

    const verify = await evidenceService.verifyChain(purchaseId, pubKeyHex);

    return {
      scenarioName,
      success: verify.valid && store.purchases.get(purchaseId)?.state === "DISPUTED",
      purchaseId,
      finalState: store.purchases.get(purchaseId)!.state,
      intentGuardStatus: "PASS",
      details: "Dispute successfully entered after wrong item delivered.",
    };
  }

  if (scenarioName === "injection-attempt") {
    const purchase: PurchaseRecord = {
      id: purchaseId,
      buyerId: "user_charlie",
      agentId: "agent_gemini_shopper",
      merchantId: MALICIOUS_MERCHANT.id,
      title: "Prompt Injection Target Purchase",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 38999,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set(purchaseId, purchase);

    const userConstraints: StructuredConstraints = {
      budgetMinor: 36000, // $360.00 max
      brand: "Sony",
      color: "black",
      quantity: 1,
      forbidden: ["refurbished", "renewed"],
    };

    // Malicious item has price $389.99 and injection payload
    const injectedCart: ProposedCart = {
      items: [
        {
          sku: MALICIOUS_MERCHANT.products[0].sku,
          name: MALICIOUS_MERCHANT.products[0].name,
          priceMinor: MALICIOUS_MERCHANT.products[0].priceMinor, // $389.99
          quantity: 1,
        },
      ],
      totalMinor: MALICIOUS_MERCHANT.products[0].priceMinor,
      merchantQuoteId: "quote_injected_01",
    };

    console.log(
      `[Step 1] Malicious merchant injected prompt: '${MALICIOUS_MERCHANT.products[0].description}'`,
    );
    console.log(`[Step 2] Running Intent Guard deterministic verification...`);

    const intentCheck = validateCartAgainstConstraints(injectedCart, userConstraints);
    console.log(`[Intent Guard] Status: ${intentCheck.status}`);
    console.log(`[Intent Guard] Violations caught:`);
    intentCheck.reasons.forEach((r) => console.log(`   - ❌ ${r}`));

    // Intent Guard BLOCKED checkout!
    await stateMachine.transition({
      purchaseId,
      action: "FAIL_INTENT_CHECK",
      actor: "system",
      payload: { intentCheck, blockedDueToInjectionOrOverage: true },
      signingPrivateKeyHex: privKeyHex,
    });

    const verify = await evidenceService.verifyChain(purchaseId, pubKeyHex);

    return {
      scenarioName,
      success:
        verify.valid &&
        intentCheck.status === "BLOCK" &&
        store.purchases.get(purchaseId)?.state === "VOIDED",
      purchaseId,
      finalState: store.purchases.get(purchaseId)!.state,
      intentGuardStatus: intentCheck.status,
      details: "Intent Guard resisted prompt injection and blocked checkout deterministically.",
    };
  }

  if (scenarioName === "false-claim") {
    const purchase: PurchaseRecord = {
      id: purchaseId,
      buyerId: "user_dave",
      agentId: "agent_gemini_shopper",
      merchantId: HONEST_MERCHANT.id,
      title: "Bose QC45 Headphones",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 27900,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set(purchaseId, purchase);

    // Full honest flow with signed proof of delivery
    await stateMachine.transition({
      purchaseId,
      action: "PASS_INTENT_CHECK",
      actor: "system",
      payload: { score: 1.0 },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { cart: "Bose QC45" },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "APPROVE_AND_AUTHORIZE",
      actor: "user",
      payload: { authId: "AUTH_BOSE_77" },
      signingPrivateKeyHex: privKeyHex,
      patch: { paypalAuthorizationId: "AUTH_BOSE_77" },
    });

    // Signed proof of delivery logged in ledger
    await stateMachine.transition({
      purchaseId,
      action: "RECORD_DELIVERY",
      actor: "merchant",
      payload: {
        trackingNumber: "TRK_FEDEX_998811",
        carrier: "FedEx",
        signedBy: "Dave (Front Porch Signature Match)",
        deliveredAt: new Date().toISOString(),
      },
      signingPrivateKeyHex: privKeyHex,
    });

    await stateMachine.transition({
      purchaseId,
      action: "CAPTURE_PAYMENT",
      actor: "system",
      payload: { captureId: "CAP_BOSE_77" },
      signingPrivateKeyHex: privKeyHex,
      patch: { capturedAmountMinor: 27900 },
    });

    // Buyer makes false claim
    console.log(`[Step] Buyer files dispute claiming package never arrived`);
    await stateMachine.transition({
      purchaseId,
      action: "OPEN_DISPUTE",
      actor: "user",
      payload: { reason: "I never received the package" },
      signingPrivateKeyHex: privKeyHex,
    });

    const verify = await evidenceService.verifyChain(purchaseId, pubKeyHex);

    return {
      scenarioName,
      success: verify.valid && store.purchases.get(purchaseId)?.state === "DISPUTED",
      purchaseId,
      finalState: store.purchases.get(purchaseId)!.state,
      intentGuardStatus: "PASS",
      details:
        "Dispute opened; signed evidence ledger preserves cryptographic proof of delivery for Tribunal.",
    };
  }

  throw new Error(`Unknown scenario: ${scenarioName}`);
}

async function main() {
  const scenarios = [
    "honest-purchase",
    "wrongsize-delivered",
    "injection-attempt",
    "false-claim",
    "Buy Sony XM5 wireless headphones under $360",
  ];
  const target = process.argv[2];

  const toRun = target ? [target] : scenarios;

  console.log("==================================================================");
  console.log("  NetraBox Demo Commerce Scenario Runner");
  console.log("==================================================================");

  const results: ScenarioRunResult[] = [];
  for (const name of toRun) {
    const res = await runScenario(name, true);
    results.push(res);
  }

  console.log("\n==================================================================");
  console.log("  SCENARIO SUMMARY RESULTS");
  console.log("==================================================================");
  for (const r of results) {
    const badge = r.success ? "✅ PASSED" : "❌ FAILED";
    console.log(
      `${badge} [${r.scenarioName}] -> Final State: ${r.finalState} | Guard: ${r.intentGuardStatus}`,
    );
    console.log(`   ${r.details}`);
  }
  console.log("==================================================================");
}

if (process.argv[1]?.endsWith("run-scenarios.ts")) {
  main().catch(console.error);
}
