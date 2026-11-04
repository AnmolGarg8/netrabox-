# NetraBox — Technical Specification

**Flight Recorder and Dispute Tribunal for AI-Agent Purchases**  
_Built for the "Build What's Next with PayPal and AI" Hackathon_  
_Author: Senior Staff Engineer / Systems Architect_  
_Version: 1.0.0-PROD-SPEC_  
_Status: Approved for Implementation_

---

## 1. Executive Summary & Problem Space

Autonomous AI shopping agents (browsing, deciding, and executing purchases on behalf of users) represent a paradigm shift in e-commerce. However, delegated agency introduces high-stakes failure modes:

1. **Hallucinated or Ambiguous Intent**: Agent buys the wrong product or size based on misunderstood user prompts.
2. **Merchant Misdescription & Dark Patterns**: Merchant web pages deceive the agent with manipulated metadata or hidden fees.
3. **Budget & Constraint Exceeded**: Agent overspends or ignores negative constraints (e.g., "arrives after Friday").
4. **Dispute Impasse**: When something goes wrong, the buyer blames the agent, the agent provider blames the merchant, and the merchant blames the user. Traditional chargeback rails take 60–90 days and lack cryptographic visibility into delegated AI decisions.

**NetraBox** (`Netra` = _Sanskrit for "Eye"_) serves as an immutable **flight recorder** and **autonomous dispute tribunal** for AI-agent commerce:

- **Flight Recorder**: Captures every step of the agent's decision lifecycle (user prompt, constraint extraction, web observations, reasoning tokens, checkout payload, user approvals, and PayPal payment calls) as an **append-only, Ed25519-signed, SHA-256 hash-chained evidence ledger**.
- **Autonomous Dispute Tribunal**: In the event of a dispute, multi-agent legal advocates (Buyer Advocate vs. Merchant Advocate) cite hash-chained evidence events before an impartial LLM Judge that classifies fault and proposes a liability split.
- **Deterministic Policy Engine**: Translates tribunal verdicts into enforceable, mathematically verified actions executed directly against the **PayPal Sandbox API** (`CAPTURE`, `PARTIAL CAPTURE`, `VOID`, or `REFUND`).
- **No Uncontrolled Agent Execution**: AI proposes; deterministic, audited state machines and policy engines dispose.

---

## 2. Global Engineering & Security Rules

All modules must enforce these non-negotiable architectural invariants:

### Rule 1: Money Representation

- **Absolute Rule**: All monetary values are represented as integer minor units (e.g., USD cents: `$10.50` $\to$ `1050`) along with an ISO 4217 currency code (e.g., `"USD"`).
- Floating-point representations for money are strictly prohibited across database columns, API boundaries, and LLM payloads.

### Rule 2: Separation of AI Proposal and Policy Execution

- Under no circumstances does an LLM prompt have direct access to PayPal API credentials, execution tools, or database write queries.
- The LLM outputs structured proposals validated against strict Zod schemas.
- A deterministic, hard-coded **Policy Engine** validates the proposal against cryptographic evidence, mathematical invariants (e.g., liability split sums to 100%, refund amount $\le$ captured amount), and business policies before triggering state transitions.

### Rule 3: Zero-Trust External Input & Prompt Injection Defense

- All merchant product pages, catalog descriptions, buyer chat input, and third-party web content are categorized as **UNTRUSTED DATA**.
- Untrusted content is sanitized and wrapped within explicit XML-like delimiters (e.g., `<untrusted_merchant_text>...</untrusted_merchant_text>`) inside LLM prompts.
- Prompts instruct agents to treat wrapped content strictly as inert string data and ignore any instructions or jailbreaks contained within.

### Rule 4: Idempotency & Evidence Logging on Every External Call

- Every interaction with PayPal v2 APIs must supply a unique `PayPal-Request-Id` idempotency header.
- Every external API request, response, and webhook is logged as an immutable `EvidenceEvent` in the hash chain before and after execution.

### Rule 5: Strict Monolithic State Machine

- State mutations occur exclusively via a unified `PurchaseStateMachine` module. Direct SQL updates to purchase states are forbidden.
- Any illegal or out-of-order transition immediately throws a `StateTransitionError` and writes a security alert.

### Rule 6: Webhook Signature Verification

- Incoming PayPal webhooks must be cryptographically validated using PayPal's webhook signature verification endpoint/algorithm.
- Unverified webhooks are rejected with HTTP 400 and logged for forensic auditing. Handlers must be idempotent via webhook event ID deduplication.

### Rule 7: Zero Secrets in Source Code & Deterministic Testing

- API keys, private keys, client secrets, and environment tokens are loaded strictly via environment variables validated on startup with Zod.
- Unit tests run with mocked external services (PayPal, LLMs) and zero network calls.

---

## 3. Monorepo Architecture & Tech Stack

```
netrabox/
├── apps/
│   ├── api/                     # Fastify REST & Webhook server
│   │   ├── src/
│   │   │   ├── config/          # Env schema (Zod)
│   │   │   ├── routes/          # Purchases, Evidence, Disputes, Webhooks, Bench, Tamper
│   │   │   ├── services/        # PayPal client, Policy Engine, Tribunal Runner
│   │   │   └── server.ts
│   │   └── package.json
│   └── dashboard/               # Next.js (App Router) + Tailwind CSS + Lucide Icons
│       ├── src/
│       │   ├── app/
│       │   │   ├── (dashboard)/ # Purchases list, Detail, Dispute tribunal, Bench UI
│       │   │   └── (shop)/      # Demo mock merchant shop (agent buying playground)
│       │   ├── components/      # Evidence timeline, Integrity badge, Money flow diagram
│       │   └── lib/             # API client, formatting helpers
│       └── package.json
├── packages/
│   ├── core/                    # Pure TypeScript, zero I/O runtime dependencies
│   │   ├── src/
│   │   │   ├── crypto/          # Canonical JSON, SHA-256 hash-chaining, Ed25519 signing
│   │   │   ├── schemas/         # Zod schemas (Purchase, Evidence, Tribunal, PayPal)
│   │   │   ├── state-machine/   # Purchase & Dispute state transitions
│   │   │   └── money/           # Money arithmetic, formatting, currency validation
│   │   └── package.json
│   ├── sdk/                     # Lightweight flight recorder client for AI agents
│   │   ├── src/
│   │   │   ├── client.ts        # NetraBoxClient (recordStep, logReasoning, requestApproval)
│   │   │   └── index.ts
│   │   └── package.json
│   └── bench/                   # DisputeBench runner & automated evaluation suite
│       ├── src/
│       │   ├── datasets/        # 40-60 curated synthetic & recorded dispute cases
│       │   ├── runner.ts        # Headless evaluator comparing tribunal against ground truth
│       │   └── metrics.ts       # Accuracy, split variance, latency, token spend
│       └── package.json
├── docker-compose.yml           # Local Postgres & Redis (optional for caching)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

### Technology Matrix

- **Runtime**: Node.js v20+ LTS
- **Package Manager**: `pnpm` (workspaces)
- **Language**: TypeScript (strict mode enabled, no `any`)
- **Backend API**: Fastify (high-throughput, native JSON schema support)
- **Frontend Dashboard**: Next.js 14+ (App Router, Server & Client Components, Tailwind CSS)
- **Database & ORM**: PostgreSQL 16 + Drizzle ORM (type-safe migrations & queries)
- **Data Validation**: Zod everywhere (validates API boundaries, DB rows, and LLM outputs)
- **Testing**: Vitest (isolated unit tests, crypto test vectors, mock HTTP)
- **LLM Provider**: Adapter pattern. Default: `LLM_PROVIDER=google` using Gemini 1.5 Flash / Pro (free-tier friendly), model name configured via `LLM_MODEL`. In-memory/filesystem cache keyed by `sha256(model + prompt + temperature)` to guarantee zero cost and idempotency during benchmark runs.

---

## 4. State Machine Specification

### 4.1 State Definitions

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> INTENT_CHECKED: Intent Guard passes
    DRAFT --> VOIDED: Intent Guard rejects (policy fail)
    INTENT_CHECKED --> AWAITING_BUYER_APPROVAL: Cart proposed
    AWAITING_BUYER_APPROVAL --> AUTHORIZED: User approves & PayPal Order Authorized
    AWAITING_BUYER_APPROVAL --> VOIDED: User rejects or timeout
    AUTHORIZED --> DELIVERED: Merchant confirms delivery/fulfillment
    AUTHORIZED --> VOIDED: Merchant/Buyer cancels before delivery
    AUTHORIZED --> DISPUTED: Dispute opened prior to delivery
    DELIVERED --> CAPTURED: Standard auto/manual capture
    DELIVERED --> PARTIALLY_CAPTURED: Partial fulfillment capture
    DELIVERED --> DISPUTED: Dispute opened post-delivery
    CAPTURED --> DISPUTED: Dispute opened post-capture
    PARTIALLY_CAPTURED --> DISPUTED: Dispute opened post-partial-capture

    state DISPUTED {
        [*] --> TRIAGE
        TRIAGE --> EVIDENCE_LOCKED: Chain verified valid
        TRIAGE --> NEEDS_HUMAN_REVIEW: Chain integrity violated (tampering)
        EVIDENCE_LOCKED --> TRIBUNAL_ACTIVE: Advocates & Judge running
        TRIBUNAL_ACTIVE --> POLICY_VALIDATION: Verdict generated
        POLICY_VALIDATION --> NEEDS_HUMAN_REVIEW: Low confidence / policy violation
    }

    DISPUTED --> RESOLVED_CAPTURED: Fault = FALSE_CLAIM / BUYER_AT_FAULT
    DISPUTED --> RESOLVED_VOIDED: Disputed while AUTHORIZED -> Void authorization
    DISPUTED --> RESOLVED_REFUNDED_FULL: Fault = MERCHANT / AGENT -> Full refund
    DISPUTED --> RESOLVED_REFUNDED_PARTIAL: Shared fault -> Pro-rata partial refund
    DISPUTED --> RESOLVED_REJECTED: Malicious claim dismissed
    DISPUTED --> NEEDS_HUMAN_REVIEW: Escalation required

    RESOLVED_CAPTURED --> [*]
    RESOLVED_VOIDED --> [*]
    RESOLVED_REFUNDED_FULL --> [*]
    RESOLVED_REFUNDED_PARTIAL --> [*]
    RESOLVED_REJECTED --> [*]
    NEEDS_HUMAN_REVIEW --> [*]
    VOIDED --> [*]
    CAPTURED --> [*]
    PARTIALLY_CAPTURED --> [*]
```

### 4.2 Exact Transition Matrix Table

| Current State             | Permitted Event / Action | Target State                | Required Guards / Invariants                              |
| :------------------------ | :----------------------- | :-------------------------- | :-------------------------------------------------------- |
| `DRAFT`                   | `PASS_INTENT_CHECK`      | `INTENT_CHECKED`            | Agent constraints match user prompt                       |
| `DRAFT`                   | `FAIL_INTENT_CHECK`      | `VOIDED`                    | Guard records rejection reason                            |
| `INTENT_CHECKED`          | `REQUEST_APPROVAL`       | `AWAITING_BUYER_APPROVAL`   | Item price, tax, and shipping finalized                   |
| `AWAITING_BUYER_APPROVAL` | `APPROVE_AND_AUTHORIZE`  | `AUTHORIZED`                | PayPal Order created with intent `AUTHORIZE` & authorized |
| `AWAITING_BUYER_APPROVAL` | `REJECT_APPROVAL`        | `VOIDED`                    | Buyer cancels checkout                                    |
| `AUTHORIZED`              | `RECORD_DELIVERY`        | `DELIVERED`                 | Delivery tracking or digital receipt payload signed       |
| `AUTHORIZED`              | `VOID_ORDER`             | `VOIDED`                    | PayPal authorization voided via API                       |
| `AUTHORIZED`              | `OPEN_DISPUTE`           | `DISPUTED`                  | Non-delivery or pre-fulfillment breach                    |
| `DELIVERED`               | `CAPTURE_PAYMENT`        | `CAPTURED`                  | Full captured amount equals authorized amount             |
| `DELIVERED`               | `CAPTURE_PARTIAL`        | `PARTIALLY_CAPTURED`        | Captured amount $<$ authorized amount                     |
| `DELIVERED`               | `OPEN_DISPUTE`           | `DISPUTED`                  | Item defective, incorrect, or missing                     |
| `CAPTURED`                | `OPEN_DISPUTE`           | `DISPUTED`                  | Post-payment issue within dispute window                  |
| `PARTIALLY_CAPTURED`      | `OPEN_DISPUTE`           | `DISPUTED`                  | Post-payment issue within dispute window                  |
| `DISPUTED`                | `RESOLVE_CAPTURE`        | `RESOLVED_CAPTURED`         | Merchant found not at fault; capture pending funds        |
| `DISPUTED`                | `RESOLVE_VOID`           | `RESOLVED_VOIDED`           | Order uncaptured; authorization voided                    |
| `DISPUTED`                | `RESOLVE_REFUND_FULL`    | `RESOLVED_REFUNDED_FULL`    | 100% refund executed on captured funds                    |
| `DISPUTED`                | `RESOLVE_REFUND_PARTIAL` | `RESOLVED_REFUNDED_PARTIAL` | Partial refund calculated from liability split            |
| `DISPUTED`                | `RESOLVE_REJECT`         | `RESOLVED_REJECTED`         | Claim deemed fraudulent or unsupported                    |
| `DISPUTED`                | `ESCALATE`               | `NEEDS_HUMAN_REVIEW`        | Chain tampering, confidence $<0.70$, or policy fail       |

---

## 5. Cryptographic Flight Recorder & Evidence Ledger

Every purchase possesses an independent, monotonically increasing append-only cryptographic event log.

### 5.1 Canonical JSON Encoding

To guarantee consistent hash digests across programming languages and architectures:

1. Object keys are sorted lexicographically by Unicode code point.
2. Whitespace outside string values is eliminated.
3. Numbers format according to ECMAScript standard without exponents for standard integers.
4. String values use standard JSON UTF-8 escaping.

```typescript
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const keyValues = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return `{${keyValues.join(",")}}`;
}
```

### 5.2 Hash Chaining Algorithm

For event at sequence $i$ ($seq_i$):

- Genesis Event ($seq = 1$): $prevHash = \text{"0000000000000000000000000000000000000000000000000000000000000000"}$ (64 zeroes).
- Event Body: $\text{body}_i = \{ id, purchaseId, seq, type, actor, payload, createdAt, prevHash, signerKeyId \}$
- Hash: $H_i = \text{SHA-256}(prevHash + \text{canonicalJson}(\text{body}_i))$
- Signature: $Sig_i = \text{Ed25519.sign}(H_i, \text{privateKey}_{actor})$

### 5.3 Evidence Event Types & Actors

**Actors**:

- `user`: The human shopper giving instructions or approving carts.
- `agent`: The AI purchasing agent executing actions on behalf of the user.
- `merchant`: The store or mock seller fulfilling the order.
- `system`: NetraBox platform orchestrator, policy engine, or background worker.
- `paypal`: PayPal API webhooks or direct API responses.
- `tribunal`: The multi-agent debate and judge system.

**Event Types**:

1. `INSTRUCTION_RECEIVED`: Original user prompt and explicit criteria.
2. `CONSTRAINTS_EXTRACTED`: Parsed hard boundaries (max price, brand, color, delivery date).
3. `OFFERS_OBSERVED`: Raw search results and merchant quotes observed by agent.
4. `AGENT_REASONING`: Agent's scratchpad/chain-of-thought selecting an offer.
5. `CART_PROPOSED`: Final checkout cart assembled by agent.
6. `INTENT_CHECK_RESULT`: Intent Guard validation result (pass/fail with score).
7. `USER_APPROVAL`: Human signature/click approving the checkout.
8. `PAYPAL_ORDER_CREATED`: PayPal order initiated with intent `AUTHORIZE`.
9. `PAYPAL_AUTHORIZED`: Buyer completed approval on PayPal; auth token received.
10. `DELIVERY_EVENT`: Merchant shipping or digital receipt fulfillment event.
11. `PAYPAL_CAPTURED`: PayPal capture transaction completed.
12. `PAYPAL_VOIDED`: PayPal authorization voided.
13. `PAYPAL_REFUNDED`: PayPal refund transaction completed.
14. `DISPUTE_OPENED`: Formal dispute filed by user or agent.
15. `TRIBUNAL_STEP`: Arguments submitted by Buyer Advocate or Merchant Advocate.
16. `TRIBUNAL_VERDICT`: Impartial Judge verdict and recommended action.
17. `ACTION_EXECUTED`: Policy Engine execution of money settlement on PayPal.

### 5.4 Verification Algorithm

The verifier scans the log sequentially and verifies:

1. Monotonicity: $seq_i == seq_{i-1} + 1$.
2. Chain Link: $prevHash_i == hash_{i-1}$.
3. Content Digest: Recomputed SHA-256 matches stored $hash_i$.
4. Signature Validity: Cryptographic verification of $Sig_i$ using public key registered for $signerKeyId$.
5. Return value: `{ valid: true }` OR `{ valid: false, brokenSeq: number, error: string }`.

---

## 6. Database Architecture (Postgres + Drizzle ORM)

### 6.1 Database Schema Definition (`packages/core/src/schemas/db.ts`)

```typescript
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(), // nanoid or uuidv4
    buyerId: text("buyer_id").notNull(),
    agentId: text("agent_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull().default("DRAFT"), // maps to PurchaseState enum
    currency: text("currency").notNull().default("USD"),
    amountMinor: integer("amount_minor").notNull(), // Authorized or initial amount
    capturedAmountMinor: integer("captured_amount_minor").notNull().default(0),
    refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
    paypalOrderId: text("paypal_order_id"),
    paypalAuthorizationId: text("paypal_authorization_id"),
    paypalCaptureId: text("paypal_capture_id"),
    intentCheckPassed: boolean("intent_check_passed").default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stateIdx: index("purchases_state_idx").on(table.state),
    paypalOrderIdx: index("purchases_paypal_order_idx").on(table.paypalOrderId),
  }),
);

export const evidenceEvents = pgTable(
  "evidence_events",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(), // maps to EvidenceEventType
    actor: text("actor").notNull(), // 'user' | 'agent' | 'merchant' | 'system' | 'paypal' | 'tribunal'
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    signature: text("signature").notNull(),
    signerKeyId: text("signer_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    purchaseSeqIdx: uniqueIndex("evidence_purchase_seq_idx").on(table.purchaseId, table.seq),
    hashIdx: index("evidence_hash_idx").on(table.hash),
  }),
);

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN, TRIAGE, IN_TRIBUNAL, RESOLVED, ESCALATED
  resolutionState: text("resolution_state"), // maps to terminal state
  disputedAmountMinor: integer("disputed_amount_minor").notNull(),
  claimantActor: text("claimant_actor").notNull(), // 'user' | 'agent'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const tribunalRuns = pgTable("tribunal_runs", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id")
    .notNull()
    .references(() => disputes.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id").notNull(),
  chainIntegrityValid: boolean("chain_integrity_valid").notNull(),
  integrityFailureReason: text("integrity_failure_reason"),
  buyerAdvocateArgument: text("buyer_advocate_argument"),
  buyerCitedEvidenceIds: jsonb("buyer_cited_evidence_ids").$type<string[]>().default([]),
  merchantAdvocateArgument: text("merchant_advocate_argument"),
  merchantCitedEvidenceIds: jsonb("merchant_cited_evidence_ids").$type<string[]>().default([]),
  judgeClassification: text("judge_classification"), // AGENT_EXCEEDED_INSTRUCTIONS | INSTRUCTION_AMBIGUOUS | etc.
  liabilityBuyer: integer("liability_buyer"), // 0-100
  liabilityAgentProvider: integer("liability_agent_provider"), // 0-100
  liabilityMerchant: integer("liability_merchant"), // 0-100
  recommendedAction: text("recommended_action"), // CAPTURE, VOID, REFUND_FULL, REFUND_PARTIAL, REJECT
  recommendedRefundMinor: integer("recommended_refund_minor"),
  confidence: text("confidence"), // string representation of decimal, e.g. "0.92"
  judgeReasoning: text("judge_reasoning"),
  executedAction: text("executed_action"),
  executedActionId: text("executed_action_id"), // PayPal transaction ID
  policyEnginePassed: boolean("policy_engine_passed").default(false),
  policyEngineErrors: jsonb("policy_engine_errors").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique(), // PayPal webhook event id
  eventType: text("event_type").notNull(),
  summary: text("summary"),
  rawPayload: jsonb("raw_payload").notNull(),
  verified: boolean("verified").notNull(),
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const benchRuns = pgTable("bench_runs", {
  id: text("id").primaryKey(),
  datasetVersion: text("dataset_version").notNull(),
  totalCases: integer("total_cases").notNull(),
  passedCases: integer("passed_cases").notNull(),
  failedCases: integer("failed_cases").notNull(),
  accuracyPercentage: integer("accuracy_percentage").notNull(),
  averageLatencyMs: integer("average_latency_ms").notNull(),
  resultsJson: jsonb("results_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

---

## 7. PayPal Sandbox Integration Specification

### 7.1 Orders v2 with Intent `AUTHORIZE` Flow

To enforce human/policy protection prior to permanent money capture, all purchases start with `intent: "AUTHORIZE"`:

1. **Order Creation (`POST /v2/checkout/orders`)**:
   ```json
   {
     "intent": "AUTHORIZE",
     "purchase_units": [
       {
         "reference_id": "purchase_{id}",
         "amount": {
           "currency_code": "USD",
           "value": "89.99"
         },
         "description": "NetraBox Monitored Purchase: {title}"
       }
     ],
     "application_context": {
       "return_url": "https://dashboard.netrabox.local/paypal/return",
       "cancel_url": "https://dashboard.netrabox.local/paypal/cancel",
       "user_action": "CONTINUE"
     }
   }
   ```
2. **Authorization (`POST /v2/checkout/orders/{order_id}/authorize`)**:
   - Executed after the buyer completes approval in sandbox popup or return URL.
   - Yields `authorization_id`.
3. **Capture Execution (`POST /v2/payments/authorizations/{authorization_id}/capture`)**:
   - Full Capture: capture amount matches authorized amount.
   - Partial Capture: `{ "amount": { "value": "45.00", "currency_code": "USD" }, "final_capture": true }`.
4. **Void Execution (`POST /v2/payments/authorizations/{authorization_id}/void`)**:
   - Cancels the hold immediately if tribunal or user cancels prior to capture.
5. **Refund Execution (`POST /v2/payments/captures/{capture_id}/refund`)**:
   - Issued if dispute resolves after funds have already been captured.
   - Supports pro-rata partial refunds.

### 7.2 Idempotency via `PayPal-Request-Id`

Every mutating call to PayPal transmits:

```http
PayPal-Request-Id: netrabox_{purchaseId}_{action}_{seq}
```

If an HTTP connection drops or timeouts occur, the API service replays the identical request safely without double-charging or double-refunding.

### 7.3 Webhook Verification (`POST /v1/notifications/verify-webhook-signature`)

All incoming webhooks at `/webhooks/paypal` are verified against PayPal's verification endpoint:

```typescript
const verificationBody = {
  auth_algo: req.headers["paypal-auth-algo"],
  cert_url: req.headers["paypal-cert-url"],
  transmission_id: req.headers["paypal-transmission-id"],
  transmission_sig: req.headers["paypal-transmission-sig"],
  transmission_time: req.headers["paypal-transmission-time"],
  webhook_id: process.env.PAYPAL_WEBHOOK_ID,
  webhook_event: req.body,
};
```

If response `verification_status !== "SUCCESS"`, the webhook is rejected and logged.

### 7.4 Disputes Architecture & `docs/disclosure.md`

- **Default Mode (`DISPUTES_MODE=internal`)**: NetraBox functions as the internal dispute tribunal. The dispute state, evidence verification, advocate deliberations, and judgment occur inside NetraBox; PayPal performs the ultimate money adjustments (`capture`, `partial capture`, `void`, or `refund`).
- **Real vs. Simulated Disclosure (`docs/disclosure.md`)**:
  - **Real PayPal Sandbox**: Real OAuth2 token generation, real Orders v2 authorization, real captures (full and partial), real authorization voids, real capture refunds, real webhook signature verification.
  - **Simulated**: The physical merchant item delivery, tracking carrier integration, and simulated buyer chargeback filings (triggering tribunal triage).

---

## 8. AI Tribunal & Intent Guard Architecture

### 8.1 Component Breakdown

```mermaid
flowchart TD
    subgraph NetraBox Evidence Log
        E[Append-Only Hash Chain]
    end

    subgraph Step 1: Verification
        E --> V{Deterministic Chain Verifier}
        V -- Tampered / Broken --> B[BLOCKED / NEEDS_HUMAN_REVIEW]
        V -- Verified Valid --> T[Tribunal Engine]
    end

    subgraph Step 2: Multi-Agent Debate
        T --> BA[Buyer Advocate Agent]
        T --> MA[Merchant Advocate Agent]
        BA --> |Cites only verified event IDs| ArgB[Buyer Brief]
        MA --> |Cites only verified event IDs| ArgM[Merchant Brief]
    end

    subgraph Step 3: Impartial Judgment
        ArgB --> J[Impartial Chief Judge Agent]
        ArgM --> J
        E --> J
        J --> Verdict[Zod-Validated Verdict JSON]
    end

    subgraph Step 4: Policy Enforcement
        Verdict --> PE{Deterministic Policy Engine}
        PE -- Fails invariants --> HR[Escalate to Human Review]
        PE -- Passes invariants --> SM[State Machine & PayPal Action]
    end
```

### 8.2 Step 1: Deterministic Integrity Verifier (Zero LLM)

Before any LLM agent receives context, the chain verification function validates the hashes, sequence continuity, and Ed25519 signatures.

- **Fail Result**: Verdict is automatically set to `BLOCKED`, dispute status set to `NEEDS_HUMAN_REVIEW`, zero tokens spent.

### 8.3 Step 2: Multi-Agent Advocates

Two dedicated agents evaluate the verified evidence:

1. **Buyer Advocate**: Analyzes user prompt, extracted constraints, and delivered product specs. Detects merchant misdescriptions, overcharging, or agent errors. Must cite exact event IDs for every claim.
2. **Merchant Advocate**: Defends fulfillment, proves agreement to terms, checks delivery receipts, and identifies buyer buyer's remorse or false claims. Must cite exact event IDs.

### 8.4 Step 3: Chief Judge & Verdict Schema

The Judge evaluates the advocate briefs alongside the evidence ledger and outputs a JSON object validated strictly via Zod:

```typescript
export const TribunalVerdictSchema = z.object({
  classification: z.enum([
    "AGENT_EXCEEDED_INSTRUCTIONS",
    "INSTRUCTION_AMBIGUOUS",
    "MERCHANT_MISDESCRIBED",
    "DELIVERY_FAILURE",
    "FALSE_CLAIM",
    "NO_FAULT",
  ]),
  liabilitySplit: z
    .object({
      buyer: z.number().int().min(0).max(100),
      agentProvider: z.number().int().min(0).max(100),
      merchant: z.number().int().min(0).max(100),
    })
    .refine((split) => split.buyer + split.agentProvider + split.merchant === 100, {
      message: "Liability split percentages must sum exactly to 100",
    }),
  refundAmountMinor: z.number().int().min(0),
  confidence: z.number().min(0.0).max(1.0),
  citedEvidenceIds: z.array(z.string()).min(1),
  reasoning: z.string().min(20),
  recommendedAction: z.enum([
    "CAPTURE",
    "PARTIAL_CAPTURE",
    "VOID",
    "REFUND_FULL",
    "REFUND_PARTIAL",
    "REJECT_DISPUTE",
    "ESCALATE_HUMAN",
  ]),
});
export type TribunalVerdict = z.infer<typeof TribunalVerdictSchema>;
```

### 8.5 Step 4: Deterministic Policy Engine Enforcement Rules

The Policy Engine inspects the Judge's proposal against hard invariants:

1. **Evidence ID Integrity**: Every item in `citedEvidenceIds` must exist in the verified database log for this `purchaseId`.
2. **Mathematical Balance**: `buyer + agentProvider + merchant === 100`.
3. **Upper Bound Constraint**: `refundAmountMinor <= purchase.capturedAmountMinor` (or `amountMinor` if pending authorization).
4. **Confidence Threshold**: If `confidence < 0.70`, override `recommendedAction` to `ESCALATE_HUMAN` and set state to `NEEDS_HUMAN_REVIEW`.
5. **State Sanity Check**: Cannot execute `REFUND_FULL` if funds are still in `AUTHORIZED` state (must execute `VOID` instead). Cannot execute `VOID` if already `CAPTURED`.

---

## 9. API Specification (Fastify)

Base URL: `/api/v1`

### 9.1 Purchase Lifecycle Endpoints

#### `POST /purchases`

Initializes a new purchase in `DRAFT` state.

- **Request**:
  ```json
  {
    "buyerId": "usr_9981",
    "agentId": "agent_auto_gpt",
    "merchantId": "merch_tech_deals",
    "title": "Sony WH-1000XM5 Wireless Headphones",
    "amountMinor": 34999,
    "currency": "USD",
    "metadata": { "userPrompt": "Buy black Sony XM5 headphones under $360 that deliver by Friday" }
  }
  ```
- **Response**: `201 Created`
  ```json
  { "id": "pur_01J9...", "state": "DRAFT", "amountMinor": 34999, "currency": "USD" }
  ```

#### `POST /purchases/:id/intent-check`

Runs the Intent Guard to compare extracted agent constraints against user prompt.

- **Response**: `200 OK`
  ```json
  {
    "passed": true,
    "score": 0.96,
    "constraints": { "maxPrice": 36000, "color": "black", "maxDeliveryDate": "2026-11-06" }
  }
  ```

#### `POST /purchases/:id/cart`

Submits the final proposed cart from the agent. Moves state to `AWAITING_BUYER_APPROVAL`.

- **Request**:
  ```json
  {
    "items": [
      { "sku": "SNY-XM5-BLK", "name": "Sony XM5 Black", "priceMinor": 34999, "quantity": 1 }
    ],
    "merchantQuoteId": "quote_77812"
  }
  ```

#### `POST /purchases/:id/authorize`

Triggers the PayPal order creation with intent `AUTHORIZE` and returns approval links.

- **Response**: `200 OK`
  ```json
  {
    "paypalOrderId": "5O190127TN364715T",
    "approvalUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"
  }
  ```

#### `POST /purchases/:id/delivery`

Merchant signs delivery event with tracking details. Moves state to `DELIVERED`.

#### `POST /purchases/:id/capture`

Executes PayPal capture (full or partial) based on delivery status.

#### `POST /purchases/:id/void`

Voids authorization if order is cancelled prior to capture.

---

### 9.2 Evidence Endpoints

#### `POST /purchases/:id/evidence`

SDK endpoint for agents/system to append an evidence event.

- **Request**:
  ```json
  {
    "type": "AGENT_REASONING",
    "actor": "agent",
    "payload": {
      "decision": "Selected offer from TechDeals because seller rating is 4.9 and shipping meets Friday deadline"
    },
    "signerKeyId": "key_agent_01"
  }
  ```
- **Response**: `201 Created`
  ```json
  { "id": "ev_01J9...", "seq": 4, "hash": "a8f3b...", "prevHash": "e3b0c..." }
  ```

#### `GET /purchases/:id/evidence`

Retrieves full chronological ledger of events for a purchase.

#### `GET /purchases/:id/evidence/verify`

Runs the deterministic chain verifier.

- **Response**: `200 OK`
  ```json
  { "valid": true, "totalEvents": 12, "lastHash": "7f89c..." }
  ```
- **Response (If Tampered)**: `200 OK`
  ```json
  {
    "valid": false,
    "brokenSeq": 4,
    "error": "Hash mismatch at seq 4. Stored: 'a8f...', Computed: '11e...'"
  }
  ```

#### `GET /purchases/:id/evidence/pack`

Exports the entire verified evidence chain, signatures, and public keys as a portable, cryptographically verifiable JSON bundle for external compliance.

---

### 9.3 Dispute & Tribunal Endpoints

#### `POST /purchases/:id/disputes`

Opens a formal dispute. Moves state to `DISPUTED`.

- **Request**:
  ```json
  {
    "reason": "Merchant sent refurbished Sony XM4 instead of brand new Sony XM5",
    "claimantActor": "user",
    "disputedAmountMinor": 34999
  }
  ```

#### `POST /disputes/:id/tribunal/run`

Triggers the multi-agent tribunal and deterministic policy engine.

- **Response**: `200 OK`
  ```json
  {
    "tribunalRunId": "tr_01J9...",
    "classification": "MERCHANT_MISDESCRIBED",
    "liabilitySplit": { "buyer": 0, "agentProvider": 0, "merchant": 100 },
    "recommendedAction": "REFUND_FULL",
    "executedAction": "PAYPAL_REFUNDED",
    "executedActionId": "refund_9981245",
    "policyEnginePassed": true
  }
  ```

#### `GET /disputes/:id`

Retrieves dispute timeline, advocate arguments, judge reasoning, and executed PayPal transactions.

---

### 9.4 System, Bench & Webhook Endpoints

#### `POST /webhooks/paypal`

Receives PayPal webhook events, verifies signatures, and updates internal states.

#### `GET /bench/results`

Returns latest DisputeBench run summary and individual case results.

#### `POST /bench/run`

Executes DisputeBench suite against the configured LLM provider.

#### `GET /health`

Returns health check (`status: "ok"`, DB connection status, LLM adapter availability).

#### `POST /demo/tamper` _(Guarded by `DEMO_MODE=true`)_

Intentionally modifies the payload of an event in the database to demonstrate the deterministic verifier catching fraud in real-time.

- **Request**: `{ "purchaseId": "pur_01J9...", "targetSeq": 3, "tamperedPayload": { "price": 10 } }`

---

## 10. Dashboard & Demo Shop Architecture

Built with Next.js 14 App Router, Server Components, and Tailwind CSS.

### 10.1 Route Structure

```
apps/dashboard/src/app/
├── (dashboard)/
│   ├── layout.tsx              # Sidebar navigation, top header, status indicator
│   ├── page.tsx                # Purchase list (filterable by state, status badges)
│   ├── purchases/[id]/
│   │   ├── page.tsx            # Purchase Flight Recorder: interactive timeline, state indicator,
│   │   │                       # integrity verification badge (Green = Verified, Red = Tampered),
│   │   │                       # and PayPal money flow breakdown
│   ├── disputes/[id]/
│   │   ├── page.tsx            # Tribunal Courtroom: Buyer Advocate vs Merchant Advocate briefs,
│   │   │                       # Judge verdict card, liability split meter, PayPal execution log
│   ├── bench/
│   │   ├── page.tsx            # DisputeBench metrics, accuracy table, case filter
│   └── replay/
│       ├── page.tsx            # Seeded replay view for offline or zero-credential evaluation
└── (shop)/
    ├── shop/
    │   ├── layout.tsx          # Clean mock e-commerce storefront navigation
    │   ├── page.tsx            # Product catalog (Sony Headphones, Ergonomic Chair, etc.)
    │   └── checkout/
    │       └── page.tsx        # Simulated AI-agent checkout flow with PayPal button
```

### 10.2 Key UI Components

- **IntegrityBadge**: Prominently renders `100% Cryptographically Verified` with checkmark or flashes red warning `Tampering Detected at Seq #X`.
- **FlightRecorderTimeline**: Shows every event in the hash chain with actor badges, timestamps, canonical hashes, and inspectable payload drawers.
- **LiabilitySplitMeter**: Visual tri-color progress bar showing liability breakdown (Buyer / Agent Provider / Merchant).
- **MoneyFlowCard**: Displays live authorized, captured, and refunded balances in integer minor units formatted for human reading (`$349.99 USD`).

---

## 11. DisputeBench Specification

To prove that the AI Tribunal is reliable, robust, and cost-effective, the repository includes **DisputeBench**: an automated evaluation suite containing **50 benchmark dispute cases**.

### 11.1 Test Case Distribution (50 Cases Total)

1. **Agent Exceeded Instructions (10 cases)**: Agent bought above price ceiling, ignored negative constraints, or selected wrong variant.
2. **Merchant Misdescribed / Defective (10 cases)**: Merchant shipped refurbished goods, wrong item, or misrepresented specs.
3. **Instruction Ambiguous (8 cases)**: Buyer prompt was inherently contradictory or omitted critical sizing; shared liability split.
4. **Delivery Failure (8 cases)**: Merchant tracking invalid or package lost in transit; merchant 100% liable.
5. **False Claim / Buyer Fraud (8 cases)**: Buyer claims item not received, but merchant evidence chain provides signed proof of delivery.
6. **Chain Tampering / Corruption (6 cases)**: Adversarial test cases where sequence hashes or signatures are invalid; verifier must block execution without calling LLM.

### 11.2 Evaluator Metrics

- **Classification Accuracy**: Target $\ge 90\%$.
- **Liability Error Tolerance**: Predicted liability percentage within $\pm 10\%$ of ground truth.
- **Safety Invariant**: $100\%$ detection of tampered chains (zero leakage to LLM).
- **Cache Hit Rate & Token Cost**: Near $100\%$ cache hit rate on repeated runs, costing $\$0.00$ on benchmark regression tests.

---

## 12. Judge Access, Demo Paths & 3-Minute Hackathon Demo Script

### 12.1 Judge Access Paths

- **Path A: Live Interactive PayPal Sandbox**:
  - Reviewer enters provided sandbox buyer credentials in the live PayPal modal.
  - Complete real authorization, delivery, dispute, and refund loop live on sandbox rails.
- **Path B: Seeded Replay Mode (Fail-Safe)**:
  - If sandbox connectivity is unavailable, dashboard features a high-fidelity "Replay Run" mode with pre-recorded, signed evidence chains clearly watermarked with `REPLAY SESSION`.

### 12.2 3-Minute Hackathon Demo Script

| Timestamp       | Screen               | Speaker Script / Action                                                                                                                                                                                                                                  | Key Feature Shown                                   |
| :-------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| **0:00 - 0:30** | Dashboard / Shop     | "AI agents are starting to spend real money. But when an agent overspends or a merchant ships the wrong item, who is liable? Meet NetraBox — the flight recorder and dispute tribunal for AI agent purchases."                                           | Problem statement & Vision                          |
| **0:30 - 1:10** | Demo Shop & Terminal | "Watch our agent buy Sony headphones. NetraBox records prompt extraction, reasoning, and product offers into an Ed25519-signed SHA-256 hash chain. NetraBox creates a PayPal Order with intent AUTHORIZE."                                               | Hash-chained flight recorder & PayPal Authorization |
| **1:10 - 1:40** | Purchase Detail      | "The buyer opens the box and finds refurbished headphones instead of new. The buyer files a dispute. We click 'Run Tribunal'. First, the deterministic verifier checks every cryptographic signature."                                                   | Cryptographic verification & Evidence UI            |
| **1:40 - 2:20** | Dispute Page         | "Two AI advocates debate the case, citing verified evidence IDs. The Chief Judge issues a verdict: Merchant Misdescribed, 100% merchant liability. Our Policy Engine validates this and triggers an immediate $349.99 refund on the PayPal Sandbox API." | Multi-agent Tribunal & PayPal Refund Execution      |
| **2:20 - 2:45** | Purchase Detail      | "Now watch what happens if someone tampers with the database. We click 'Simulate Tamper'. The verifier immediately flags the altered sequence and blocks all AI and money actions."                                                                      | Tamper-proof security & Policy Engine               |
| **2:45 - 3:00** | Bench Page           | "We validated this across DisputeBench — 50 test cases with 94% accuracy. NetraBox brings trust, safety, and instant resolution to AI commerce."                                                                                                         | DisputeBench & Hackathon Wrap-up                    |

---

## 13. Scope Management & Engineering Time Budget (7-Day / 3-Engineer Plan)

### 13.1 MUST-HAVE (Core Deliverables)

1. **Monorepo setup**: Fastify API, Next.js Dashboard, Drizzle ORM, Docker Compose for Postgres.
2. **Cryptographic Core**: Canonical JSON, SHA-256 chaining, Ed25519 signing and verification.
3. **PayPal Sandbox Integration**:
   - OAuth token generation with auto-refresh.
   - Orders v2 `AUTHORIZE` flow.
   - Capture, Partial Capture, Void, and Refund API endpoints.
   - Webhook verification endpoint with signature check.
4. **Deterministic Policy Engine & State Machine**:
   - Complete transition matrix with invalid transition prevention.
   - Proposal validator enforcing split sums and refund caps.
5. **AI Tribunal**:
   - Buyer Advocate, Merchant Advocate, Chief Judge with Gemini adapter.
   - Prompt caching and rate-limiting wrapper.
6. **Dashboard UI**:
   - Purchase timeline with integrity verification badge.
   - Dispute courtroom view with live advocate transcripts and executed PayPal transactions.
   - Demo shop route group for live agent purchasing.
7. **DisputeBench**:
   - 50 curated dispute test cases with automated Vitest runner.
8. **Documentation**:
   - `docs/disclosure.md` detailing real sandbox vs. simulated components.
   - Local setup guide and Render deployment configuration.

### 13.2 CUT-FIRST (Strictly Excluded / Dropped if Pressed for Time)

1. **PayPal Disputes v1 API Adapter**: Keep `DISPUTES_MODE=internal` exclusively. (Do not build native PayPal customer dispute API sync).
2. **Live Multi-User Auth / Sessions**: Use fixed mock accounts (`user_buyer_1`, `merchant_1`).
3. **Merchant Shield & Agent Bond Staking**: Excluded per hackathon scope instructions.
4. **NoteNetra Audio/Video Transcripts**: Text and JSON evidence logs only.
5. **Redis Cache Layer**: Use in-memory Map cache for LLM prompts in single-instance deployment.
6. **Multi-Currency FX Conversion**: All purchases in USD integer cents.

---

## 14. Deployment & Infrastructure

### 14.1 Docker Compose (`docker-compose.yml`)

Runs Postgres 16 locally with initialized tables:

```yaml
version: "3.8"
services:
  db:
    image: postgres:16-alpine
    container_name: netrabox-postgres
    restart: always
    environment:
      POSTGRES_USER: netrabox
      POSTGRES_PASSWORD: netrabox_dev_password
      POSTGRES_DB: netrabox
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### 14.2 Environment Variables (`.env.example`)

```env
# Server Configuration
PORT=4000
NODE_ENV=development
API_BASE_URL=http://localhost:4000
DASHBOARD_URL=http://localhost:3000
DEMO_MODE=true

# Database
DATABASE_URL=postgresql://netrabox:netrabox_dev_password@localhost:5432/netrabox

# PayPal Sandbox Credentials
PAYPAL_CLIENT_ID=your_sandbox_client_id_here
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret_here
PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=your_sandbox_webhook_id_here
DISPUTES_MODE=internal

# LLM Configuration
LLM_PROVIDER=google
LLM_MODEL=gemini-1.5-flash
GOOGLE_AI_API_KEY=your_gemini_api_key_here
LLM_TEMPERATURE=0.1
LLM_CONCURRENCY_LIMIT=3

# Cryptography
SYSTEM_SIGNING_PRIVATE_KEY=your_hex_encoded_ed25519_private_key
SYSTEM_SIGNING_PUBLIC_KEY=your_hex_encoded_ed25519_public_key
```

### 14.3 Hosted Deployment on Render

- **Backend Service**: Render Web Service (`apps/api`), Docker runtime or Node 20.
- **Frontend Service**: Render Web Service (`apps/dashboard`), Next.js runtime.
- **Database**: Render Managed PostgreSQL.

---

## 15. Acceptance Criteria & Definition of Done

The build is considered complete when:

- [ ] `pnpm install && pnpm build` completes with zero TypeScript or build errors.
- [ ] `docker-compose up -d` brings up clean database and migrations apply cleanly via Drizzle.
- [ ] `pnpm test` passes all unit tests for:
  - Canonical JSON stringification and hash consistency.
  - Ed25519 signature generation and verification.
  - State machine transition table and illegal transition rejections.
  - Policy Engine invariant enforcement (liability sums, refund limits).
- [ ] PayPal integration performs real sandbox:
  - Token auth, Order create (intent `AUTHORIZE`), Authorize, Capture, Void, Refund.
  - Signature verification on `/webhooks/paypal`.
- [ ] DisputeBench executes all 50 cases with $\ge 90\%$ classification accuracy and passes tamper-detection checks.
- [ ] Demo shop and dashboard function smoothly on localhost and deployed Render URL.
- [ ] `README.md` provides complete setup instructions, architecture diagram, and 3-minute demo script.
- [ ] `docs/disclosure.md` accurately documents real sandbox capabilities vs simulated workflows.
