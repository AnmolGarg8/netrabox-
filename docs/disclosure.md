# NetraBox — Technical & Evaluative Disclosure

> **Submission Transparency Statement**  
> Built for the _"Build What's Next with PayPal and AI"_ Hackathon.

This document explicitly defines the boundaries between real PayPal sandbox integrations and simulated workflows, clarifies the empirical scope of the DisputeBench dataset, and credits the AI tooling utilized during development.

---

## 1. What is Real PayPal Sandbox vs. What is Simulated

NetraBox operates directly against PayPal's official Sandbox infrastructure (`https://api-m.sandbox.paypal.com`), using live REST APIs with Orders v2 authorization-capture mechanics.

### Real PayPal Sandbox Capabilities

- **OAuth 2.0 Client Credentials Authentication**:
  - Live Bearer token negotiation against `/v1/oauth2/token` with in-memory caching and automatic refresh before expiration.
- **Orders v2 with `intent: "AUTHORIZE"`**:
  - Live creation of authorization orders via `/v2/checkout/orders` with application context (`user_action: "CONTINUE"`), currency, and line items.
- **Order Authorization**:
  - Live authorization of buyer approval via `/v2/checkout/orders/{order_id}/authorize`. Funds are reserved on the buyer's PayPal account rather than captured immediately.
- **Capture Execution (Full & Partial)**:
  - Live capture of authorized holds via `/v2/payments/authorizations/{authorization_id}/capture` with explicit `final_capture: true/false` flags.
- **Void Execution**:
  - Immediate cancellation of authorization holds via `/v2/payments/authorizations/{authorization_id}/void` (e.g., when Intent Guard blocks an order or before shipment).
- **Refund Execution (Full & Partial)**:
  - Live post-capture monetary refunds via `/v2/payments/captures/{capture_id}/refund` when the autonomous tribunal resolves in favor of the buyer.
- **Cryptographic Webhook Signature Verification**:
  - Live validation of incoming PayPal webhook events against `/v1/notifications/verify-webhook-signature` using `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, and `transmission_time`.
- **Strict Idempotency & 72-Hour Deduplication Window**:
  - Per official PayPal REST API v2 documentation, `PayPal-Request-Id` headers are cached and honored by PayPal servers for **72 hours** (3 days).
  - NetraBox routes all mutating financial calls exclusively through a monolithic `SettlementService`, generating deterministic keys (`set_<purchaseId>_<kind>_<amountMinor>_seq<sequence>`). Within the 72-hour window, identical requests return the cached response without duplicate capture or refund actions.
  - An automated reconciliation daemon (`POST /jobs/reconcile`) recovers pending or interrupted settlement transactions older than 30 seconds by querying PayPal with the same idempotency key.

### What is Simulated / Mocked for Demo & Benchmarking

- **Physical Shipping Carrier Webhooks**:
  - In a production logistics pipeline, carriers (FedEx, UPS, DHL) push delivery scan webhooks. For sandbox reproducibility, shipping delivery events are simulated via synthetic telemetry events (`DELIVERY_EVENT`).
- **Simulated Merchant Storefronts**:
  - Two simulated merchants (`m_tech_haven` and `m_malicious_seller`) represent external third-party retailers to test adversarial prompt injections and delivery discrepancies without requiring live commercial e-commerce storefronts.
- **Demo Mode Buyer Approval Shortcut**:
  - In addition to standard PayPal Sandbox redirect logins, a one-click simulated buyer approval modal is available in `DEMO_MODE=true` to allow judges to test complete end-to-end flows in seconds without needing personal PayPal sandbox test accounts.
- **Disputes Mode (`DISPUTES_MODE=internal`)**:
  - PayPal's native customer disputes API (`Disputes v1`) requires manual back-and-forth resolution between real human PayPal customer service portals. NetraBox implements an _Autonomous Internal Tribunal_ that settles disputes via programmatic Void, Capture, or Refund on PayPal rails.

---

## 2. DisputeBench Dataset & Methodology Disclosure

### Purpose and Dataset Generation

`DisputeBench` is an automated evaluation suite comprising 52 synthetic dispute cases covering:

1. Legitimate fulfillment (on-time delivery, accurate descriptions)
2. Merchant faults (wrong item, defect, partial shipment, delayed fulfillment)
3. Buyer/Agent faults (false claims, ambiguous prompt constraints, rogue buyer behavior)
4. Adversarial attacks (cryptographic database tampering, reordered hash chains, forged Ed25519 signatures, prompt injection within product catalogs, prompt injection within buyer claims).

### Meaning of Benchmark Labels

> [!IMPORTANT]
> **Ground-Truth Labeling Disclosure**:  
> All 52 benchmark scenarios were authored and labeled by the NetraBox development team based on formal transaction specifications.
>
> **These results demonstrate internal architectural consistency, adherence to policy bounds, and cryptographic tamper resistance.** They do not claim to represent empirical statistical distributions of live consumer e-commerce fraud rates.

- **Tamper Detection (100%)**: Proves that SHA-256 hash chaining and Ed25519 digital signatures mathematically detect any altered payload before LLM agents are invoked.
- **Injection Resistance (100%)**: Proves that structural constraint validation and untrusted data delimiters isolate the judge LLM from catalog prompt attacks.
- **Deterministic Policy Validation**: Confirms that 100% of awarded refunds and liability splits satisfy monetary conservation bounds ($0 \le \text{refund} \le \text{captured}$) and never execute hallucinated amounts.

---

## 3. AI Tooling Disclosure

In accordance with hackathon submission guidelines, the development team utilized the following AI platforms:

1. **Google Antigravity**:
   - Used as the primary agentic development environment for codebase architecture, monorepo scaffolding, TypeScript strict typing, state machine validation, Next.js dashboard styling, and automated test authoring.
2. **Claude (Anthropic)**:
   - Utilized during early design phases for prompt engineering, crafting adversary prompt injection payloads, and authoring adversarial test personas for DisputeBench.
3. **Google Gemini (`gemini-1.5-flash` / `gemini-1.5-pro`)**:
   - Deployed inside the NetraBox runtime to power Intent Guard constraint extraction, Buyer Advocate legal arguments, Merchant Advocate defense briefs, and Autonomous Chief Judge liability rulings.

---

## 4. Financial Calculation Transparency

- **Floating-Point Prohibition**: Floating-point numbers are strictly prohibited in financial code. All prices, authorizations, captures, holds, and refunds are calculated in integer minor units (USD cents).
- **No Direct AI Money Execution**: No AI agent possesses access to PayPal API credentials or authorization tokens. AI models output structured verdicts which must pass through a 100% pure-code deterministic Policy Engine before any PayPal settlement API call is constructed.
