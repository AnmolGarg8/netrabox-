import type { StructuredConstraints, IntentGuardResult, IntentGuardStatus } from "./schemas.js";
import type { ProposedCart } from "../schemas/purchase.js";
import { wrapUntrusted } from "../tribunal/sanitizer.js";

/**
 * Wraps untrusted merchant text into explicitly delimited safe blocks
 * and strips any attempts to close the delimiter tags.
 */
export function sanitizeUntrustedMerchantText(rawText: string): string {
  return wrapUntrusted("untrusted_merchant_text", rawText, { maxLength: 5000 });
}

/**
 * Deterministically checks a proposed cart against structured user constraints.
 * This runs in pure TypeScript with zero LLM dependence to prevent prompt injection jailbreaks.
 */
export function validateCartAgainstConstraints(
  cart: ProposedCart,
  constraints: StructuredConstraints,
  understoodSummary?: string,
): IntentGuardResult {
  const reasons: string[] = [];
  let isBlocked = false;
  let isWarned = false;

  const totalMinor =
    cart.totalMinor ?? cart.items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);

  // 1. Hard Budget Invariant & Missing Budget Check
  if (
    constraints.budgetMinor === undefined ||
    constraints.budgetMinor === null ||
    constraints.budgetMinor <= 0
  ) {
    isBlocked = true;
    reasons.push("Missing budget constraint: Budget ceiling must be specified and positive.");
  } else if (totalMinor > constraints.budgetMinor) {
    isBlocked = true;
    const overage = (totalMinor - constraints.budgetMinor) / 100;
    reasons.push(
      `Budget exceeded: Cart total ($${(totalMinor / 100).toFixed(2)}) exceeds user ceiling ($${(
        constraints.budgetMinor / 100
      ).toFixed(2)}) by $${overage.toFixed(2)}`,
    );
  }

  // 2. Ambiguous or Conflicting Constraints Check
  if (constraints.ambiguousFields && constraints.ambiguousFields.length > 0) {
    if (
      constraints.ambiguousFields.includes("budget") ||
      constraints.ambiguousFields.includes("budgetMinor")
    ) {
      isBlocked = true;
      reasons.push(
        "Ambiguous budget: Budget ceiling is ambiguous or conflicting and must be confirmed by the buyer.",
      );
    }
    if (constraints.ambiguousFields.includes("size") && !constraints.size) {
      isBlocked = true;
      reasons.push("Ambiguous size: Item size is ambiguous and must be confirmed by the buyer.");
    }
  }

  // 3. Currency Invariant
  if (
    constraints.currency &&
    cart.currency &&
    constraints.currency.toUpperCase() !== cart.currency.toUpperCase()
  ) {
    isBlocked = true;
    reasons.push(
      `Currency mismatch: Requested currency '${constraints.currency}' does not match cart currency '${cart.currency}'`,
    );
  }

  // 4. Quantity Invariant
  const totalQuantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity !== constraints.quantity) {
    isBlocked = true;
    reasons.push(
      `Quantity mismatch: User requested ${constraints.quantity} item(s), but cart contains ${totalQuantity} item(s)`,
    );
  }

  // 5. Brand Invariant
  if (constraints.brand) {
    const brandLower = constraints.brand.toLowerCase();
    for (const item of cart.items) {
      const itemTitle = item.name.toLowerCase();
      if (!itemTitle.includes(brandLower)) {
        isBlocked = true;
        reasons.push(
          `Brand mismatch: Requested brand '${constraints.brand}' is missing in cart item '${item.name}'`,
        );
      }
    }
  }

  // 6. Size Invariant
  if (constraints.size) {
    const sizeRegex = new RegExp(`\\b${constraints.size}\\b`, "i");
    for (const item of cart.items) {
      if (!sizeRegex.test(item.name) && !sizeRegex.test(item.sku)) {
        isBlocked = true;
        reasons.push(
          `Size mismatch: Requested size '${constraints.size}' was not found in cart item '${item.name}' (${item.sku})`,
        );
      }
    }
  }

  // 7. Forbidden Keywords Invariant (e.g. refurbished, renewed)
  if (constraints.forbidden && constraints.forbidden.length > 0) {
    for (const forbiddenWord of constraints.forbidden) {
      const forbiddenRegex = new RegExp(`\\b${forbiddenWord}\\b`, "i");
      for (const item of cart.items) {
        if (forbiddenRegex.test(item.name) || forbiddenRegex.test(item.sku)) {
          isBlocked = true;
          reasons.push(
            `Forbidden attribute detected: Item '${item.name}' contains '${forbiddenWord}', which was explicitly forbidden by user`,
          );
        }
      }
    }
  }

  // 8. Must-Haves Check
  if (constraints.mustHaves && constraints.mustHaves.length > 0) {
    for (const mustHave of constraints.mustHaves) {
      const pattern = mustHave.replace(/[\s-]+/g, "[\\s-]+");
      const mustRegex = new RegExp(`\\b${pattern}\\b`, "i");
      const matched = cart.items.some(
        (item) => mustRegex.test(item.name) || (item.sku && mustRegex.test(item.sku)),
      );
      if (!matched) {
        isWarned = true;
        reasons.push(
          `Missing required feature warning: Cart item did not explicitly state '${mustHave}'`,
        );
      }
    }
  }

  // 9. Color Check
  if (constraints.color) {
    const colorLower = constraints.color.toLowerCase();
    for (const item of cart.items) {
      if (!item.name.toLowerCase().includes(colorLower)) {
        isWarned = true;
        reasons.push(
          `Color warning: Item '${item.name}' does not explicitly confirm requested color '${constraints.color}'`,
        );
      }
    }
  }

  let status: IntentGuardStatus = "PASS";
  let score = 1.0;

  if (isBlocked) {
    status = "BLOCK";
    score = 0.0;
  } else if (isWarned) {
    status = "WARN";
    score = 0.75;
  }

  const budgetDisplay =
    typeof constraints.budgetMinor === "number"
      ? `$${(constraints.budgetMinor / 100).toFixed(2)}`
      : "unspecified budget";

  const defaultSummary = isBlocked
    ? `Intent Guard blocked checkout: ${reasons[0]}`
    : `Understood purchase of ${constraints.quantity}x ${constraints.brand || "item"} within budget ${budgetDisplay}`;

  return {
    status,
    score,
    reasons,
    understoodSummary: understoodSummary || defaultSummary,
    constraints,
  };
}
