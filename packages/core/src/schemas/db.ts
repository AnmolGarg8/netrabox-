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
    id: text("id").primaryKey(),
    buyerId: text("buyer_id").notNull(),
    agentId: text("agent_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("USD"),
    amountMinor: integer("amount_minor").notNull(),
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
  (table) => [
    index("purchases_state_idx").on(table.state),
    index("purchases_paypal_order_idx").on(table.paypalOrderId),
  ],
);

export const evidenceEvents = pgTable(
  "evidence_events",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    signature: text("signature").notNull(),
    signerKeyId: text("signer_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evidence_purchase_seq_idx").on(table.purchaseId, table.seq),
    index("evidence_hash_idx").on(table.hash),
  ],
);

export const disputes = pgTable("disputes", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("OPEN"),
  resolutionState: text("resolution_state"),
  disputedAmountMinor: integer("disputed_amount_minor").notNull(),
  claimantActor: text("claimant_actor").notNull(),
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
  judgeClassification: text("judge_classification"),
  liabilityBuyer: integer("liability_buyer"),
  liabilityAgentProvider: integer("liability_agent_provider"),
  liabilityMerchant: integer("liability_merchant"),
  recommendedAction: text("recommended_action"),
  recommendedRefundMinor: integer("recommended_refund_minor"),
  confidence: text("confidence"),
  judgeReasoning: text("judge_reasoning"),
  executedAction: text("executed_action"),
  executedActionId: text("executed_action_id"),
  policyEnginePassed: boolean("policy_engine_passed").default(false),
  policyEngineErrors: jsonb("policy_engine_errors").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
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
