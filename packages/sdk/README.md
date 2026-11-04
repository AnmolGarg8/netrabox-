# @netrabox/sdk

> Thin TypeScript flight recorder for autonomous AI purchasing agents.

`@netrabox/sdk` allows shopping agents to cryptographically stream evidence into NetraBox, capturing user prompts, product search observations, agent reasoning, tool executions, and proposed carts.

---

## Installation

```bash
pnpm add @netrabox/sdk @netrabox/core
```

---

## Usage Example

```typescript
import { NetraBoxRecorder } from "@netrabox/sdk";

// 1. Initialize flight recorder client
const recorder = new NetraBoxRecorder({
  apiUrl: "http://localhost:4000",
  signerKeyId: "agent_gpt4_shopper",
  defaultActor: "agent",
});

const purchaseId = "pur_98124";

// 2. Record User Prompt
await recorder.recordInstruction(
  purchaseId,
  "Buy black Sony XM5 headphones under $360 that deliver by Friday",
  {
    buyerId: "user_441",
    constraints: { maxPriceMinor: 36000, color: "black", deadline: "2026-11-06" },
  },
);

// 3. Wrap External Tools (measures timing, logs inputs & outputs automatically)
async function searchCatalog(query: string) {
  // Simulated search API call
  return [
    {
      id: "sny_1",
      title: "Sony WH-1000XM5 Black",
      priceMinor: 34999,
      merchantId: "merch_sound",
      inStock: true,
    },
    {
      id: "sny_2",
      title: "Sony WH-1000XM5 Silver",
      priceMinor: 35500,
      merchantId: "merch_audio",
      inStock: true,
    },
  ];
}

const monitoredSearch = recorder.wrapTool(searchCatalog, {
  purchaseId,
  toolName: "SearchCatalogAPI",
});

const offers = await monitoredSearch("Sony WH-1000XM5");

// 4. Record Observed Offers
await recorder.recordOffers(purchaseId, "Sony WH-1000XM5", offers);

// 5. Record Agent Reasoning & Decision Rationale
await recorder.recordReasoning(
  purchaseId,
  "Selected offer from merch_sound ($349.99): Meets black color constraint and stays below $360 budget limit.",
  "Scratchpad: Comparing merchant ratings: merch_sound has 4.9/5 stars and 2-day delivery.",
  "sny_1",
);

// 6. Record Proposed Cart
await recorder.recordCart(purchaseId, {
  items: [{ sku: "SNY-XM5-BLK", name: "Sony WH-1000XM5 Black", priceMinor: 34999, quantity: 1 }],
  totalMinor: 34999,
  merchantQuoteId: "quote_sound_9918",
});
```
