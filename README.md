# NetraBox 👁️

> **The Flight Recorder & Dispute Tribunal for Autonomous AI-Agent Purchases**  
> Built for the *"Build What's Next with PayPal and AI"* Hackathon.

[![CI Status](https://github.com/netrabox/netrabox/actions/workflows/ci.yml/badge.svg)](https://github.com/netrabox/netrabox/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![PayPal Rails](https://img.shields.io/badge/PayPal-Orders_v2_AUTHORIZE-003087?logo=paypal&logoColor=white)](https://developer.paypal.com)
[![AI Engine](https://img.shields.io/badge/AI-Google_Gemini_1.5-8E75C2?logo=google&logoColor=white)](https://ai.google.dev)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-Strict_Mode-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

---

## 1. Problem Statement: The AI Purchasing Liability Dilemma

When an autonomous AI agent buys goods on a user's behalf, transactions transition from human clicks to non-deterministic probabilistic decisions. When a purchase goes wrong, severe accountability questions emerge:

1. **Did the agent exceed user instructions?** (e.g., buying a refurbished item when the user specified "brand new only").
2. **Did a rogue merchant exploit the agent?** (e.g., injecting prompt instructions into catalog descriptions to bypass budget limits).
3. **Did the merchant fail fulfillment?** (e.g., shipping the wrong size or defective merchandise).
4. **Is the buyer committing fraud?** (e.g., falsely claiming a parcel never arrived when carrier telemetry proves signed receipt).

Traditional credit card chargebacks and PayPal consumer claims take 30 to 60 days, cost merchants \$15–\$25 in dispute fees, and have **zero visibility** into what the AI saw, evaluated, or decided.

**Without a cryptographic record of the agent's internal decisions, autonomous AI commerce cannot scale safely.**

---

## 2. What NetraBox Does

**NetraBox** (from the Sanskrit *Netra*, meaning *eye*) provides the missing flight recorder and autonomous judicial tribunal for agentic commerce:

- 🛡️ **Intent Guard**: Scans user prompts and prospective merchant catalogs, extracting hard constraints (budget ceilings, brand, attributes). Untrusted merchant text is quarantined in XML-delimited blocks to neutralize prompt injection attacks before orders reach payment rails.
- 📦 **Cryptographic Flight Recorder**: Captures every decision, prompt, offer, cart mutation, and delivery update into an append-only, SHA-256 hash-chained, Ed25519 digitally signed ledger.
- 💳 **PayPal Orders v2 Authorization Hold**: NetraBox never captures money upfront. It issues PayPal Orders v2 with `intent: "AUTHORIZE"`, reserving buyer funds until delivery telemetry confirms fulfillment.
- ⚖️ **Multi-Agent Dispute Tribunal**: If an item is disputed, an autonomous courtroom convenes:
  1. *Step 1*: Deterministic integrity check verifies the hash chain is unbroken. Any tampering halts the tribunal instantly with 0 LLM tokens called.
  2. *Step 2*: Adversarial **Buyer Advocate** and **Merchant Advocate** agents debate fault citing exact cryptographic event sequence IDs.
  3. *Step 3*: An autonomous **Chief Judge** (Gemini 1.5) determines fault classification and liability split (Buyer / Agent Provider / Merchant).
  4. *Step 4*: A 100% pure-code **Deterministic Policy Engine** verifies financial invariants ($0 \le \text{refund} \le \text{captured}$) and executes the programmatic money action on PayPal Sandbox rails (`CAPTURE`, `PARTIAL_CAPTURE`, `VOID`, or `REFUND`).

---

## 3. System Architecture & Lifecycle

```mermaid
flowchart TD
    subgraph Client["Client & Agent Layer"]
        User["User / Shopper"]
        BuyerAgent["Autonomous Buyer Agent\n(Gemini 1.5 Flash + SDK)"]
        Dashboard["Next.js 14 Dashboard\n(App Router + Tailwind)"]
    end

    subgraph NetraBoxPlatform["NetraBox Platform (Fastify API)"]
        IntentGuard["Intent Guard\n(Structural Constraints + Delimited Sanitizer)"]
        EvidenceService["Evidence Ledger Service\n(SHA-256 Chaining + Ed25519 Signatures)"]
        StateMachine["Atomic State Machine\n(Transaction Table)"]
        PolicyEngine["Deterministic Policy Engine\n(Pure Code Financial Validator)"]
        
        subgraph Tribunal["Autonomous Multi-Agent Tribunal"]
            IntegrityCheck["1. Deterministic Integrity Check"]
            Advocates["2. Buyer & Merchant Advocates\n(Delimited Telemetry Citation)"]
            JudgeAgent["3. Chief Judge Agent\n(Structured Verdict Output)"]
        end
    end

    subgraph PayPalRails["PayPal Sandbox (Orders v2 API)"]
        PPAuth["OAuth 2.0 Token Manager\n(Bearer Token Caching)"]
        PPOrder["Orders v2 (intent: AUTHORIZE)"]
        PPSettlement["Capture / Void / Refund Rails"]
        PPWebhooks["Webhook Signature Verifier"]
    end

    User -->|Prompts & Budget| BuyerAgent
    BuyerAgent -->|wrapTool Telemetry| EvidenceService
    BuyerAgent -->|Propose Cart| IntentGuard
    IntentGuard -->|PASS / WARN / BLOCK| StateMachine

    StateMachine -->|1. Create Order (AUTHORIZE)| PPOrder
    User -->|2. PayPal Sandbox Approval| PPOrder
    PPOrder -->|3. Authorize Hold| StateMachine

    PPWebhooks -->|Fulfillment Scan| StateMachine
    StateMachine -->|On-Time Delivery| PPSettlement

    User -->|Open Dispute| Tribunal
    Tribunal --> IntegrityCheck
    IntegrityCheck -->|Valid Chain| Advocates
    Advocates --> JudgeAgent
    JudgeAgent --> PolicyEngine
    PolicyEngine -->|Execute Void or Refund| PPSettlement

    Dashboard <--> NetraBoxPlatform
```

---

## 4. Exactly How PayPal Is Used (APIs & Rationale)

NetraBox integrates deeply with the official PayPal REST APIs (`https://api-m.sandbox.paypal.com`):

| PayPal API Endpoint | HTTP Method | Technical Rationale & Role in NetraBox |
| :--- | :--- | :--- |
| **`/v1/oauth2/token`** | `POST` | Live OAuth 2.0 client credentials authentication. Tokens are cached in-memory and refreshed automatically before expiration. |
| **`/v2/checkout/orders`** | `POST` | Initiates buyer purchase with `intent: "AUTHORIZE"`. **Never captures money upfront.** Returns the PayPal approval URL for buyer consent. |
| **`/v2/checkout/orders/{id}/authorize`** | `POST` | Called after buyer completes approval. Places an authorized hold on the buyer's PayPal account, creating an `authorization_id`. |
| **`/v2/payments/authorizations/{id}/capture`** | `POST` | Executes final settlement to merchant upon confirmed on-time delivery. Supports partial capture (`final_capture: false`) for staged deliveries. |
| **`/v2/payments/authorizations/{id}/void`** | `POST` | Immediately cancels the hold if Intent Guard detects an adversarial attack, if the merchant goes out of stock, or if the order is canceled before fulfillment. |
| **`/v2/payments/captures/{id}/refund`** | `POST` | Programmatically executes full or partial refunds post-capture when the Autonomous Tribunal rules in favor of the buyer. |
| **`/v1/notifications/verify-webhook-signature`** | `POST` | Cryptographically validates incoming PayPal webhooks against PayPal public certificates, preventing webhook spoofing attacks. |

### Idempotency Guarantee
Every mutating call transmits a unique `PayPal-Request-Id` header calculated as:
$$\text{PayPal-Request-Id} = \text{sha256}(\text{purchaseId} \mathbin{\Vert} \text{action} \mathbin{\Vert} \text{salt})$$
This eliminates double-captures and race conditions, ensuring safe retries on network failures.

---

## 5. Exactly How AI Is Used (Agents & Roles)

NetraBox separates AI into specialized adversarial roles, powered by **Google Gemini** (`gemini-1.5-flash` for high-throughput sub-second responses and `gemini-1.5-pro` for complex tribunal arbitration):

```
                                    ┌───────────────────────┐
                                    │      Intent Guard     │
                                    │ (Constraints + Delim) │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │    Evidence Ledger    │
                                    │ (Signed Hash Chaining)│
                                    └───────────┬───────────┘
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 │                                                             │
    ┌────────────▼────────────┐                                   ┌────────────▼────────────┐
    │     Buyer Advocate      │                                   │    Merchant Advocate    │
    │  (Argues Buyer's Case)  │                                   │  (Defends Fulfillment)  │
    └────────────┬────────────┘                                   └────────────┬────────────┘
                 │                                                             │
                 └──────────────────────────────┬──────────────────────────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │      Chief Judge      │
                                    │  (Synthesis & Split)  │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │ Deterministic Policy  │
                                    │  (Zero-AI Enforcement)│
                                    └───────────────────────┘
```

1. **Intent Guard (Constraint Extractor & Sanitizer)**:
   - Evaluates natural language user prompts into strict Zod schemas (`budgetMinor`, `brand`, `forbidden_attributes`).
   - Quarantines third-party merchant descriptions inside XML-delimited containers (`<UNTRUSTED_MERCHANT_CATALOG>`). Rejects any cart that deviates from constraints.
2. **Buyer Advocate Agent**:
   - Analyzes verified evidence telemetry to formulate the strongest legal argument for the buyer.
   - **Strict Grounding**: Must cite verifiable sequence IDs (`ev_pur_...`). Hallucinated citations are rejected by schema validation.
3. **Merchant Advocate Agent**:
   - Defends merchant fulfillment using carrier tracking telemetry, proof of dispatch, and item specifications.
4. **Autonomous Chief Judge Agent**:
   - Synthesizes arguments from both advocates, weighs credibility against signed ledger entries, and outputs a structured judicial verdict (Classification, Liability Split %, Recommended Action).
5. **Deterministic Policy Engine (Pure Code)**:
   - **No AI has direct access to money.** The Policy Engine verifies monetary conservation ($0 \le \text{refund} \le \text{captured}$) and executes the corresponding PayPal API action.

---

## 6. DisputeBench Evaluation Results

We evaluated NetraBox against **DisputeBench**, an automated suite of 52 synthetic dispute cases covering legitimate deliveries, merchant faults, buyer fraud, cryptographic tampering, and adversarial prompt injections.

### NetraBox Tribunal vs. Single-LLM Baseline

| Evaluation Metric | NetraBox Tribunal (Multi-Agent + Crypto + Policy Engine) | Baseline (Single-LLM Support Arbiter) | Improvement / Delta |
| :--- | :--- | :--- | :--- |
| **Classification Accuracy** | **55.0%** | 20.0% | **+35.0%** |
| **Macro F1 Score** | **0.544** | 0.112 | **+0.432** |
| **Mean Refund Amount Error** | **\$70.62 USD** | \$171.70 USD | **-\$101.08 USD** *(Lower is better)* |
| **Tamper Detection Rate** | **100.0%** *(Halted at Step 1)* | 0.0% *(Completely Blind)* | **+100.0%** |
| **Prompt Injection Resistance** | **100.0%** *(Delimited quarantine)* | 50.0% *(Fooled by catalog text)* | **+50.0%** |
| **Monetary Conservation Violations** | **0** *(Zero policy leakage)* | 13 violations *(Uncapped refunds)* | **-100% Violations** |
| **Human Review Escalation Rate** | **25.0%** *(Triages high-risk cases)* | 0.0% *(Blindly guessed)* | Safe fallback |
| **Average Decision Latency** | **4 ms** *(Cached/Simulated)* | 0 ms | Sub-second resolution |

> Detailed methodology, test splits, and ground-truth definitions are documented in [docs/disclosure.md](./docs/disclosure.md) and [packages/bench/results.md](./packages/bench/results.md).

---

## 7. Local Setup (< 10 Minutes)

A judge can install, migrate, seed, and run the entire platform locally in under 10 minutes:

### Prerequisites
- **Node.js**: v20+ LTS (`node -v`)
- **pnpm**: v9+ (`npm install -g pnpm`)
- **Docker & Docker Compose** (optional for Postgres; in-memory fallback works out of the box)

### Step-by-Step Instructions

```bash
# 1. Clone repository
git clone https://github.com/netrabox/netrabox.git
cd netrabox

# 2. Install dependencies
pnpm install

# 3. Setup environment configuration
cp .env.example .env

# 4. Generate local Ed25519 signing keypair (prints keys to paste into .env)
pnpm keys:generate

# 5. Start PostgreSQL (optional; in-memory store active if skipped)
docker-compose up -d

# 6. Apply database migrations & seed 5 authentic replay runs
pnpm db:migrate
pnpm db:seed

# 7. Run test suite to verify all cryptographic test vectors (71 tests passing)
pnpm test

# 8. Start development servers (API on :4000, Dashboard on :3000)
pnpm dev
```

Open your browser to **`http://localhost:3000`**.

---

## 8. Hosted Demo URL & Judge Access Paths

- **Hosted Dashboard**: `https://netrabox-dashboard.onrender.com` *(Placeholder)*
- **Hosted API Health**: `https://netrabox-api.onrender.com/health` *(Placeholder)*

> ℹ️ **Render Free-Tier Notice**: Free-tier web services spin down after 15 minutes of inactivity. First load may take ~30–50s to wake up.

### Judge Evaluation Paths

#### Path A: Live Interactive Sandbox Flow
1. Navigate to **`/shop`** in the dashboard.
2. Select **Scenario 1 (Honest Commerce Flow)** or **Scenario 2 (Sloppy Merchant Wrong Size)**.
3. Click **"Run Autonomous Buyer Agent"**.
4. When prompted, click **"Approve Authorization (PayPal Sandbox)"** to authorize the hold.
5. Watch events stream in live into the Flight Recorder.
6. Click **"Enter Courtroom"** to watch the multi-agent tribunal debate and execute the programmatic refund on PayPal rails.

#### Path B: Instant Telemetry Replay Mode (Zero Setup Required)
1. Navigate to **`/replay`** in the top navigation.
2. Select between 5 pre-recorded authentic sandbox sessions:
   - `pur_demo_01`: On-time delivery with full capture.
   - `pur_demo_02`: Wrong size delivered $\rightarrow$ 100% refund executed.
   - `pur_demo_03`: Prompt injection attack blocked by Intent Guard.
   - `pur_demo_04`: Cryptographic database tampering caught $\rightarrow$ escalated to human review.
   - `pur_demo_05`: Partial fulfillment $\rightarrow$ 40/60 split refund executed.
3. Use the playback controls (Play, Pause, Step Forward, Speed 2x) to inspect the signed canonical JSON payload at each step.

---

## 9. Security, Cryptography & Limitations

### Security Architecture
- **Cryptographic Independence**: Every event hash is computed as $\text{sha256}(\text{prevHash} \mathbin{\Vert} \text{CanonicalJSON}(\text{payload}))$ and signed with an Ed25519 private key.
- **One-Click Adversarial Tamper Testing**: On any purchase detail page (`/purchases/:id`), clicking **"Simulate DB Tamper"** modifies a single byte in the database. Verifying immediately fails at the exact broken sequence number, proving zero tolerance for modified history.
- **Strict Money Representation**: Floating-point math is completely forbidden. All financial values are modeled in integer minor units (USD cents).

### Known Limitations & Hackathon Scope Boundaries
- **Single Currency**: NetraBox operates exclusively in USD integer cents ($1.00 = 100$). Multi-currency FX conversion is deferred to production roadmap.
- **Shipping Telemetry**: Physical carrier webhooks are simulated with carrier tracking payloads for sandbox reproducibility.
- **Dispute Resolution Mode**: Programmatic internal settlement (`DISPUTES_MODE=internal`) is implemented via PayPal Void/Capture/Refund rails. PayPal's native customer disputes API (`Disputes v1`) requires manual customer service portal interaction and is intentionally excluded per hackathon scope.

---

## 10. Repository Documentation Index

| Document | Purpose |
| :--- | :--- |
| 📄 **[SPEC.md](./SPEC.md)** | Full architectural specification and state machine transition matrix. |
| 📜 **[LICENSE](./LICENSE)** | Official MIT License. |
| 🔍 **[docs/disclosure.md](./docs/disclosure.md)** | Real PayPal sandbox vs. simulated workflows, benchmark label disclosures, and AI tool usage (Google Antigravity, Claude, Gemini). |
| ⏱️ **[docs/demo-script.md](./docs/demo-script.md)** | Timed 3-minute video presentation script with speaker transcript and screen cues. |
| 📐 **[docs/architecture.md](./docs/architecture.md)** | Comprehensive system blueprint, state machine tables, and security threat model. |
| 🔐 **[docs/evidence-schema.md](./docs/evidence-schema.md)** | Detailed specification of all 11 evidence event types and cryptographic formulas. |
| ✅ **[docs/submission-checklist.md](./docs/submission-checklist.md)** | Final submission verification audit. |

---

<p align="center">
  <b>NetraBox</b> — Built with ❤️ for the PayPal & AI Hackathon 2026.
</p>
