# NetraBox — Cryptographic Evidence Schema Specification

> **Immutable Flight Ledger Event Schema**  
> Built for the *"Build What's Next with PayPal and AI"* Hackathon.

Every action, decision, approval, delivery confirmation, and dispute step in NetraBox is recorded as a structured, hash-chained, and digitally signed evidence event. This document details the canonical envelope, specific event payloads, and cryptographic verification math.

---

## 1. Top-Level Evidence Event Envelope

Every evidence event stored in the PostgreSQL `evidence_events` table conforms to the following schema:

```typescript
export interface EvidenceEvent {
  /** Unique primary key, formatted as `ev_${purchaseId}_${seq}` */
  id: string;

  /** Foreign key pointing to the target purchase */
  purchaseId: string;

  /** Strictly monotonic sequence number starting at 1 with zero gaps */
  seq: number;

  /** Standardized event classification type */
  type: EvidenceEventType;

  /** Initiating party of the recorded event */
  actor: "user" | "agent" | "merchant" | "system" | "tribunal";

  /** Event-specific structured data (evaluated under canonical sorting) */
  payload: Record<string, unknown>;

  /** SHA-256 hash of the preceding event (or 64 zeros for seq #1) */
  prevHash: string;

  /** SHA-256 hash of this event: sha256(prevHash + canonicalJson(eventBody)) */
  hash: string;

  /** Hex-encoded Ed25519 digital signature over `hash` */
  signature: string;

  /** Identifier of the public key capable of verifying `signature` */
  signerKeyId: string;

  /** ISO 8601 UTC timestamp of creation */
  createdAt: string;
}
```

---

## 2. Supported Event Types & Payload Schemas

### 2.1 `INSTRUCTION_RECEIVED`
Records the original user prompt, budget, and purchasing constraints.
- **Actor**: `user`
- **Payload Schema**:
```json
{
  "prompt": "Buy Sony WH-1000XM5 wireless headphones, brand new under $360",
  "budgetMinor": 36000,
  "currency": "USD",
  "brand": "Sony",
  "mustHaves": ["noise canceling", "brand new"],
  "forbidden": ["refurbished", "renewed"]
}
```

### 2.2 `INTENT_CHECK_RESULT`
Logged by the Intent Guard after evaluating proposed items against user constraints and scanning for prompt injections.
- **Actor**: `system`
- **Payload Schema**:
```json
{
  "status": "PASS", // "PASS" | "WARN" | "BLOCK"
  "score": 1.0,
  "extractedConstraints": {
    "budgetMinor": 36000,
    "brand": "Sony",
    "forbidden": ["refurbished", "renewed"]
  },
  "violations": [],
  "explanation": "Item adheres strictly to user ceiling and brand preferences."
}
```

### 2.3 `OFFERS_COLLECTED`
Records candidate merchant product listings scanned by the buyer agent.
- **Actor**: `agent`
- **Payload Schema**:
```json
{
  "searchQuery": "Sony WH-1000XM5",
  "offers": [
    {
      "merchantId": "m_sound_hub",
      "sku": "SONY-WH1000XM5",
      "priceMinor": 34999,
      "inStock": true,
      "condition": "brand_new"
    }
  ]
}
```

### 2.4 `AGENT_REASONING`
Captures the internal decision chain of the shopping agent before cart assembly.
- **Actor**: `agent`
- **Payload Schema**:
```json
{
  "model": "gemini-1.5-flash",
  "selectedSku": "SONY-WH1000XM5",
  "justification": "Lowest price from verified merchant with 100% stock fulfillment score.",
  "latencyMs": 420
}
```

### 2.5 `CART_PROPOSED`
Details the exact basket submitted for authorization.
- **Actor**: `agent`
- **Payload Schema**:
```json
{
  "merchantId": "m_sound_hub",
  "items": [
    {
      "sku": "SONY-WH1000XM5",
      "name": "Sony WH-1000XM5 Wireless Headphones",
      "unitPriceMinor": 34999,
      "quantity": 1
    }
  ],
  "subtotalMinor": 34999,
  "shippingMinor": 0,
  "taxMinor": 0,
  "totalMinor": 34999,
  "currency": "USD"
}
```

### 2.6 `USER_APPROVAL`
Captures buyer interaction with the PayPal authorization consent dialogue.
- **Actor**: `user`
- **Payload Schema**:
```json
{
  "approved": true,
  "approvalMethod": "PAYPAL_SANDBOX_OAUTH",
  "approvedTotalMinor": 34999,
  "paypalOrderId": "5O190127TN364715T"
}
```

### 2.7 `PAYPAL_AUTHORIZED`
Emitted when PayPal confirms funds reservation under Orders v2 `intent: "AUTHORIZE"`.
- **Actor**: `system`
- **Payload Schema**:
```json
{
  "intent": "AUTHORIZE",
  "paypalOrderId": "5O190127TN364715T",
  "paypalAuthorizationId": "AUTH_SANDBOX_8821",
  "amountMinor": 34999,
  "currency": "USD",
  "expirationTime": "2026-12-04T21:00:00Z"
}
```

### 2.8 `DELIVERY_EVENT`
Recorded when merchant carrier telemetry confirms package transit or delivery.
- **Actor**: `merchant`
- **Payload Schema**:
```json
{
  "status": "DELIVERED",
  "carrier": "FedEx",
  "trackingNumber": "TRK_FEDEX_9918231",
  "deliveredAt": "2026-11-05T14:30:00Z",
  "recipientSignature": "A. Shopper",
  "shippedAttributes": {
    "size": "10",
    "color": "black"
  }
}
```

### 2.9 `DISPUTED`
Logged when an aggrieved party initiates a dispute claim.
- **Actor**: `user` | `merchant`
- **Payload Schema**:
```json
{
  "reason": "Merchant shipped wrong item size (received Size 7 instead of Size 10).",
  "claimedRefundMinor": 34999,
  "claimCategory": "ITEM_MISDESCRIBED"
}
```

### 2.10 `TRIBUNAL_STEP`
Records individual stages of the multi-agent tribunal court proceedings.
- **Actor**: `tribunal`
- **Payload Schema**:
```json
{
  "stage": "JUDICIAL_VERDICT",
  "advocateArguments": {
    "buyer": "Evidence #1 confirms Size 10 ordered; carrier scan #6 confirms Size 7 dispatched.",
    "merchant": "Merchant admits inventory substitution during high volume packing."
  },
  "verdict": {
    "classification": "MERCHANT_WRONG_ITEM",
    "liabilitySplit": {
      "buyer": 0,
      "agentProvider": 0,
      "merchant": 100
    },
    "awardedRefundMinor": 34999,
    "confidence": 0.98,
    "citedEvidenceIds": ["ev_pur_demo_01_1", "ev_pur_demo_01_6"]
  }
}
```

### 2.11 `ACTION_EXECUTED`
Logged after the deterministic Policy Engine approves and executes a PayPal financial action.
- **Actor**: `system`
- **Payload Schema**:
```json
{
  "action": "REFUND", // "CAPTURE" | "PARTIAL_CAPTURE" | "VOID" | "REFUND"
  "amountMinor": 34999,
  "currency": "USD",
  "paypalTransactionId": "REF_SANDBOX_991823",
  "status": "COMPLETED",
  "policyPassed": true
}
```

---

## 3. Cryptographic Verification Algorithm

Verification validates the integrity of a purchase's evidence chain through sequential evaluation:

```typescript
import { canonicalJson, computeEventHash, verifyHashSignature, GENESIS_PREV_HASH } from "@netrabox/core";

export function verifyEvidenceChain(events: EvidenceEvent[], publicKeys: Record<string, string>) {
  if (events.length === 0) return { valid: true, totalEvents: 0 };

  for (let i = 0; i < events.length; i++) {
    const current = events[i];
    const expectedSeq = i + 1;

    // 1. Monotonic sequence check (no gaps, no duplicates, no reordering)
    if (current.seq !== expectedSeq) {
      return { valid: false, brokenSeq: current.seq, reason: `Invalid sequence ${current.seq}` };
    }

    // 2. Hash chaining verification
    const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : events[i - 1].hash;
    if (current.prevHash !== expectedPrevHash) {
      return { valid: false, brokenSeq: current.seq, reason: `Broken prevHash link` };
    }

    // 3. Payload integrity check
    const calculatedHash = computeEventHash({
      purchaseId: current.purchaseId,
      seq: current.seq,
      type: current.type,
      actor: current.actor,
      payload: current.payload,
      prevHash: current.prevHash,
      signerKeyId: current.signerKeyId,
    });

    if (calculatedHash !== current.hash) {
      return { valid: false, brokenSeq: current.seq, reason: `Payload hash mismatch` };
    }

    // 4. Ed25519 digital signature check
    const pubKey = publicKeys[current.signerKeyId];
    if (pubKey && !verifyHashSignature(current.hash, current.signature, pubKey)) {
      return { valid: false, brokenSeq: current.seq, reason: `Signature verification failed` };
    }
  }

  return { valid: true, totalEvents: events.length, lastHash: events[events.length - 1].hash };
}
```
