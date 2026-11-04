import { db, sql } from "./client.js";
import { purchases } from "../schemas/db.js";

async function seed() {
  console.log("Seeding initial mock data...");
  try {
    await db
      .insert(purchases)
      .values({
        id: "pur_seed_demo_01",
        buyerId: "user_demo_buyer",
        agentId: "agent_gemini_shopper",
        merchantId: "merchant_sound_hub",
        title: "Sony WH-1000XM5 Wireless Noise-Canceling Headphones",
        state: "DRAFT",
        currency: "USD",
        amountMinor: 34999,
        capturedAmountMinor: 0,
        refundedAmountMinor: 0,
        metadata: {
          note: "Seed purchase initialized for development testing",
        },
      })
      .onConflictDoNothing();

    console.log("Database seeded successfully.");
  } catch (err) {
    console.error("Seeding failed (database may not be reachable in this step):", err);
  } finally {
    await sql.end();
  }
}

seed();
