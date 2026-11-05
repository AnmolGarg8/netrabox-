# NetraBox — 3-Minute Video / Live Demo Script

> **Target Duration**: Exactly 3 minutes (180 seconds)  
> **Audience**: Hackathon Judges, Engineers, Product Judges  
> **Objective**: Showcase how NetraBox solves AI agent purchase uncertainty using signed evidence, PayPal Orders v2 rails, and an autonomous dispute tribunal.

---

## Timeline & Scene Overview

| Timecode        | Section                       | Key Screen / URL                        | Core Message                                                                                       |
| :-------------- | :---------------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------- |
| **0:00 - 0:30** | **The Problem**               | Slide / Landing Overview                | Autonomous AI agents spend real money without accountability.                                      |
| **0:30 - 1:05** | **Live Purchase Flow**        | `/shop` $\rightarrow$ `/purchases/[id]` | Intent Guard verifies constraints; PayPal `AUTHORIZE` holds funds.                                 |
| **1:05 - 1:40** | **Dispute & Refund**          | `/disputes/[id]`                        | Sloppy merchant ships wrong size; Tribunal debates & refunds 100%.                                 |
| **1:40 - 2:05** | **False Claim Defense**       | `/shop` (Scenario 4)                    | Buyer falsely claims lost parcel; Signed tracking protects merchant.                               |
| **2:05 - 2:30** | **Tamper Detection**          | `/purchases/[id]` (Tamper button)       | DB altered $\rightarrow$ Hash chain fails $\rightarrow$ Tribunal halts $\rightarrow$ Human review. |
| **2:30 - 3:00** | **DisputeBench & Conclusion** | `/bench`                                | 52 benchmark cases; 100% tamper & injection defense; Production ready.                             |

---

## Detailed Transcript & Screen Actions

### Scene 1: The Problem (0:00 – 0:30)

- **On Screen**: Show the NetraBox Dashboard homepage (`http://localhost:3000`) with active ledger and state badges (`CAPTURED`, `DISPUTED`, `VOIDED`).
- **Speaker**:
  > _"When an autonomous AI agent buys goods on your behalf, who is responsible when things go wrong? Did the agent hallucinate? Did a rogue seller inject a malicious prompt? Or did the user change their mind?"_
  > _"Traditional chargebacks take 60 days, cost merchants \$20 in fees, and lack digital proof of an AI's internal decisions."_
  > _"Meet **NetraBox**—the flight recorder and autonomous dispute tribunal for AI commerce. NetraBox cryptographically signs every agent decision onto an immutable hash-chained ledger, integrates PayPal Orders v2 authorization holds, and resolves disputes in seconds through an adversarial AI tribunal."_

---

### Scene 2: Live Purchase Flow & Intent Guard (0:30 – 1:05)

- **On Screen**: Navigate to `/shop`. Select **Scenario 1: Honest Commerce Flow**. Click _"Run Autonomous Buyer Agent"_.
- **Speaker**:
  > _"Let's watch an agent purchase a pair of Sony noise-canceling headphones for Alice."_
  > _"Step 1: Our SDK records the user prompt as an Ed25519-signed evidence event."_
  > _"Step 2: Intent Guard deterministically checks the catalog against user constraints. Budget: under \$360. Condition: Brand New. Result: PASS."_
  > _"Step 3: Crucially, NetraBox never captures money immediately. It calls PayPal Orders v2 with `intent: AUTHORIZE`. The buyer approves via PayPal Sandbox, and funds are safely held in escrow."_
  > _"When the carrier confirms delivery, NetraBox executes a clean PayPal capture. Notice the flight recorder timeline: 7 events, sequentially chained with SHA-256 and signed with Ed25519."_

---

### Scene 3: Autonomous Dispute & 100% PayPal Refund (1:05 – 1:40)

- **On Screen**: Navigate to `/shop`, select **Scenario 2: Sloppy Merchant (Wrong Size)**, then click into the resulting dispute page (`/disputes/disp_demo_02`).
- **Speaker**:
  > _"Now, what happens when a merchant delivers the wrong item? Alice ordered Size 10 sneakers, but the merchant shipped Size 7."_
  > _"Alice's agent opens a dispute. Instantly, our multi-agent courtroom convenes:"_
  > _"1. Step 1: Deterministic integrity check verifies the hash chain is unbroken."_
  > _"2. Step 2: The Buyer Advocate presents telemetry proof citing Event #1 and #3. The Merchant Advocate defends fulfillment citing the tracking scan."_
  > _"3. Step 3: Our Chief Judge, powered by Gemini 1.5, classifies the issue as `MERCHANT_WRONG_ITEM` and awards a 100% buyer refund."_
  > _"4. Step 4: The deterministic Policy Engine verifies mathematical bounds and executes a live PayPal `REFUND` transaction on sandbox capture `CAP_SANDBOX_4422`. Resolution time: under 4 seconds."_

---

### Scene 4: False Claim Defense (1:40 – 2:05)

- **On Screen**: Show `/shop` Scenario 4 (False Claim Defense) and dispute resolution view.
- **Speaker**:
  > _"NetraBox doesn't just protect buyers—it protects honest merchants from buyer fraud."_
  > _"In this scenario, a buyer agent claimed the parcel never arrived. But NetraBox cross-referenced carrier tracking event #6 signed by the carrier. The Tribunal rejected the claim with `BUYER_FAULT`, awarded 0% refund, and preserved the merchant's payment."_

---

### Scene 5: Cryptographic Tamper Detection (2:05 – 2:30)

- **On Screen**: Navigate to `/purchases/pur_demo_01`. Point out the green _"Cryptographic Chain: VERIFIED"_ badge. Click the red _"Simulate DB Tamper"_ button.
- **Speaker**:
  > _"What if an attacker hacks the database or tampers with historical logs?"_
  > _"Let's click 'Simulate DB Tamper'. A single byte in Event #2's payload is silently modified in the database."_
  > _"When we click 'Verify Now', the cryptographic verifier catches the broken SHA-256 hash at sequence #2. The badge turns red: `TAMPER DETECTED`."_
  > _"The Tribunal automatically trips a safety breaker: zero LLM calls, zero money movements, status set to `NEEDS_HUMAN_REVIEW`. No compromised evidence can ever trigger PayPal financial actions."_

---

### Scene 6: DisputeBench & Conclusion (2:30 – 3:00)

- **On Screen**: Navigate to `/bench`. Scroll through the KPI cards, the baseline comparison table, and the 52-case breakdown.
- **Speaker**:
  > _"We validated this architecture across **DisputeBench**, our evaluation suite of 52 adversarial dispute cases."_
  > _"Compared to a baseline single-LLM approach, NetraBox achieves:"_
  > _"• **100% Tamper Detection** vs. 0% for baseline."_
  > _"• **100% Prompt Injection Resistance** against adversarial merchant catalog exploits."_
  > _"• **0% Monetary Conservation Violations**, guaranteed by our deterministic policy engine."_
  > _"NetraBox makes autonomous AI commerce safe, auditable, and accountable on PayPal rails. Thank you!"_
