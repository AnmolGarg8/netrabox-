# NetraBox

> **Flight recorder and dispute tribunal for AI-agent purchases**  
> Built for the _"Build What's Next with PayPal and AI"_ Hackathon.

NetraBox cryptographically captures every decision of an AI purchasing agent into an append-only, Ed25519-signed, SHA-256 hash-chained ledger. If a dispute arises, an autonomous multi-agent tribunal (Buyer Advocate, Merchant Advocate, Chief Judge) reviews the evidence, and a deterministic policy engine executes resolution actions directly on PayPal Sandbox rails (`CAPTURE`, `PARTIAL CAPTURE`, `VOID`, or `REFUND`).

---

## Technical Specification

The complete architectural blueprint, database schemas, state machine matrices, cryptographic specs, API definitions, and demo instructions are documented in:

📄 **[SPEC.md](./SPEC.md)**

---

## Monorepo Layout (Upcoming)

```
netrabox/
├── apps/
│   ├── api/             # Fastify REST & PayPal Webhook API
│   └── dashboard/       # Next.js App Router Dashboard & Demo Storefront
├── packages/
│   ├── core/            # Cryptographic hash-chain, Zod schemas, State Machine
│   ├── sdk/             # Lightweight NetraBox recorder for shopping agents
│   └── bench/           # DisputeBench (50 curated benchmark cases)
├── docker-compose.yml   # PostgreSQL setup
└── SPEC.md              # Full System Specification
```

---

## Quick Reference

- **Tech Stack**: TypeScript, Fastify, Next.js, Drizzle ORM, PostgreSQL, PayPal Orders v2 API, Google Gemini.
- **Rules**: Zero floating-point money (integer minor units only), AI proposes while deterministic policy engine executes, zero prompt injection tolerance.
