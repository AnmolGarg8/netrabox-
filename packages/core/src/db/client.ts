import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "../schemas/db.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export function getInitialSchemaSql(): string {
  const candidatePaths = [
    resolve(currentDir, "../../drizzle/0000_initial_schema.sql"),
    resolve(currentDir, "../drizzle/0000_initial_schema.sql"),
    resolve(currentDir, "./0000_initial_schema.sql"),
    resolve(process.cwd(), "packages/core/drizzle/0000_initial_schema.sql"),
    resolve(process.cwd(), "drizzle/0000_initial_schema.sql"),
  ];
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      return readFileSync(p, "utf8");
    }
  }
  return `
    CREATE TABLE IF NOT EXISTS "purchases" (
      "id" text PRIMARY KEY NOT NULL,
      "buyer_id" text NOT NULL,
      "agent_id" text NOT NULL,
      "merchant_id" text NOT NULL,
      "title" text NOT NULL,
      "state" text DEFAULT 'DRAFT' NOT NULL,
      "currency" text DEFAULT 'USD' NOT NULL,
      "amount_minor" integer NOT NULL,
      "captured_amount_minor" integer DEFAULT 0 NOT NULL,
      "refunded_amount_minor" integer DEFAULT 0 NOT NULL,
      "paypal_order_id" text,
      "paypal_authorization_id" text,
      "paypal_capture_id" text,
      "intent_check_passed" boolean DEFAULT false,
      "metadata" jsonb DEFAULT '{}'::jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "evidence_events" (
      "id" text PRIMARY KEY NOT NULL,
      "purchase_id" text NOT NULL REFERENCES "purchases"("id") ON DELETE cascade,
      "seq" integer NOT NULL,
      "type" text NOT NULL,
      "actor" text NOT NULL,
      "payload" jsonb NOT NULL,
      "prev_hash" text NOT NULL,
      "hash" text NOT NULL,
      "signature" text NOT NULL,
      "signer_key_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "disputes" (
      "id" text PRIMARY KEY NOT NULL,
      "purchase_id" text NOT NULL REFERENCES "purchases"("id") ON DELETE cascade,
      "reason" text NOT NULL,
      "status" text DEFAULT 'OPEN' NOT NULL,
      "dispute_phase" text DEFAULT 'TRIAGE' NOT NULL,
      "resolution_state" text,
      "disputed_amount_minor" integer NOT NULL,
      "claimant_actor" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "resolved_at" timestamp with time zone
    );
    CREATE TABLE IF NOT EXISTS "tribunal_runs" (
      "id" text PRIMARY KEY NOT NULL,
      "dispute_id" text NOT NULL REFERENCES "disputes"("id") ON DELETE cascade,
      "purchase_id" text NOT NULL,
      "chain_integrity_valid" boolean NOT NULL,
      "integrity_failure_reason" text,
      "buyer_advocate_argument" text,
      "buyer_cited_evidence_ids" jsonb DEFAULT '[]'::jsonb,
      "merchant_advocate_argument" text,
      "merchant_cited_evidence_ids" jsonb DEFAULT '[]'::jsonb,
      "judge_classification" text,
      "liability_buyer" integer,
      "liability_agent_provider" integer,
      "liability_merchant" integer,
      "recommended_action" text,
      "recommended_refund_minor" integer,
      "confidence" text,
      "judge_reasoning" text,
      "executed_action" text,
      "executed_action_id" text,
      "policy_engine_passed" boolean DEFAULT false,
      "policy_engine_errors" jsonb DEFAULT '[]'::jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "webhook_logs" (
      "id" text PRIMARY KEY NOT NULL,
      "event_id" text NOT NULL UNIQUE,
      "event_type" text NOT NULL,
      "summary" text,
      "raw_payload" jsonb NOT NULL,
      "verified" boolean NOT NULL,
      "processed" boolean DEFAULT false NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "bench_runs" (
      "id" text PRIMARY KEY NOT NULL,
      "dataset_version" text NOT NULL,
      "total_cases" integer NOT NULL,
      "passed_cases" integer NOT NULL,
      "failed_cases" integer NOT NULL,
      "accuracy_percentage" integer NOT NULL,
      "average_latency_ms" integer NOT NULL,
      "results_json" jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "settlement_actions" (
      "id" text PRIMARY KEY NOT NULL,
      "purchase_id" text NOT NULL REFERENCES "purchases"("id") ON DELETE cascade,
      "dispute_id" text,
      "kind" text NOT NULL,
      "amount_minor" integer NOT NULL,
      "currency" text DEFAULT 'USD' NOT NULL,
      "idempotency_key" text NOT NULL UNIQUE,
      "status" text DEFAULT 'PENDING' NOT NULL,
      "requested_by" text NOT NULL,
      "verdict_id" text,
      "reviewer_id" text,
      "reason" text,
      "paypal_capture_id" text,
      "paypal_refund_id" text,
      "paypal_authorization_id" text,
      "paypal_debug_id" text,
      "error_message" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "purchases_state_idx" ON "purchases" ("state");
    CREATE INDEX IF NOT EXISTS "purchases_paypal_order_idx" ON "purchases" ("paypal_order_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "evidence_purchase_seq_idx" ON "evidence_events" ("purchase_id", "seq");
    CREATE INDEX IF NOT EXISTS "evidence_hash_idx" ON "evidence_events" ("hash");
    CREATE UNIQUE INDEX IF NOT EXISTS "settlement_idempotency_idx" ON "settlement_actions" ("idempotency_key");
    CREATE INDEX IF NOT EXISTS "settlement_purchase_idx" ON "settlement_actions" ("purchase_id");
    CREATE INDEX IF NOT EXISTS "settlement_status_idx" ON "settlement_actions" ("status");
  `;
}

export type DbType =
  | ReturnType<typeof drizzlePglite<typeof schema>>
  | ReturnType<typeof drizzlePostgres<typeof schema>>
  | (ReturnType<typeof drizzlePglite<typeof schema>> & { pgClient: PGlite });

export function initPgliteDatabase(dataDir?: string): DbType {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const sqlContent = getInitialSchemaSql();
  pg.exec(sqlContent);
  const instance = drizzlePglite(pg, { schema });
  return Object.assign(instance, { pgClient: pg });
}

let activeDb: DbType | null = null;
let activeSql: ReturnType<typeof postgres> | null = null;

const dbUrl = process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith("postgres") && !dbUrl.includes(":memory:") && dbUrl !== "pglite") {
  try {
    activeSql = postgres(dbUrl, { max: 10 });
    activeDb = drizzlePostgres(activeSql, { schema });
  } catch {
    activeDb = initPgliteDatabase();
  }
} else {
  activeDb = initPgliteDatabase();
}

export const db: DbType = activeDb;
export const sql = activeSql;
export { schema };
