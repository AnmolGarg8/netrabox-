import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { PayPalClient } from "./services/paypal/client.js";
import { PurchaseStateMachineService, type IStateStore } from "./services/state-machine/machine.js";
import { InMemoryStateStore } from "./services/state-machine/in-memory-store.js";
import { DrizzleStateStore } from "./services/state-machine/drizzle-store.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { purchaseRoutes } from "./routes/purchases.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { disputeRoutes } from "./routes/disputes.js";
import { benchRoutes } from "./routes/bench.js";
import { EvidenceService } from "./services/evidence/service.js";
import { TribunalRunner } from "./services/tribunal/runner.js";
import {
  MockLLMAdapter,
  GeminiLLMAdapter,
  type LLMAdapter,
  generateEd25519Keypair,
  validateEd25519PrivateKey,
  getPublicKeyFromPrivate,
} from "@netrabox/core";

export const PINO_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "req.headers['paypal-auth-assertion']",
  "req.headers['paypal-client-metadata-id']",
  "*.password",
  "*.secret",
  "*.token",
  "*.client_secret",
  "*.clientSecret",
  "*.clientId",
  "*.client_id",
  "*.access_token",
  "*.accessToken",
  "*.refresh_token",
  "*.refreshToken",
  "*.webhookId",
  "*.webhook_id",
  "*.SIGNING_PRIVATE_KEY",
  "*.signingPrivateKey",
  "*.signingPrivateKeyHex",
  "*.PAYPAL_CLIENT_SECRET",
  "*.paypalClientSecret",
  "*.PAYPAL_CLIENT_ID",
  "*.paypalClientId",
  "body.password",
  "body.secret",
  "body.token",
  "body.clientSecret",
  "body.client_secret",
  "body.accessToken",
  "body.access_token",
  "body.refreshToken",
  "body.signingPrivateKey",
  "body.signingPrivateKeyHex",
];

export interface ServerOptions {
  store?: IStateStore;
  paypalClient?: PayPalClient;
  evidenceService?: EvidenceService;
  tribunalRunner?: TribunalRunner;
  llm?: LLMAdapter;
  signingPrivateKeyHex?: string;
  signingPublicKeyHex?: string;
  publicBaseUrl?: string;
  dashboardUrl?: string;
  demoMode?: boolean;
  isTest?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const isTest = options.isTest ?? process.env.NODE_ENV === "test";

  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: process.env.LOG_LEVEL || "info",
          redact: {
            paths: PINO_REDACT_PATHS,
            censor: "[REDACTED]",
          },
        },
  });

  app.register(cors, {
    origin: true,
  });

  app.register(sensible);

  // Initialize backing state store
  const store =
    options.store ||
    (process.env.DATABASE_URL ? new DrizzleStateStore() : new InMemoryStateStore());

  // Initialize PayPal client
  const paypalClient =
    options.paypalClient ||
    new PayPalClient({
      clientId: process.env.PAYPAL_CLIENT_ID || "mock_client_id",
      clientSecret: process.env.PAYPAL_CLIENT_SECRET || "mock_client_secret",
      environment: (process.env.PAYPAL_ENV as "sandbox" | "live") || "sandbox",
      baseUrl: process.env.PAYPAL_API_BASE_URL,
      webhookId: process.env.PAYPAL_WEBHOOK_ID,
    });

  // Strict Ed25519 Keypair Resolution:
  // In non-test environments, fail fast if SIGNING_PRIVATE_KEY is missing or malformed.
  // In tests, dynamically generate a fresh ephemeral keypair if none was provided. Never use a fixed literal.
  let signingPrivateKeyHex = options.signingPrivateKeyHex || process.env.SIGNING_PRIVATE_KEY;
  let signingPublicKeyHex = options.signingPublicKeyHex || process.env.SIGNING_PUBLIC_KEY;

  if (!signingPrivateKeyHex) {
    if (isTest) {
      const ephemeral = generateEd25519Keypair();
      signingPrivateKeyHex = ephemeral.privateKeyHex;
      signingPublicKeyHex = ephemeral.publicKeyHex;
    } else {
      throw new Error(
        "FATAL: SIGNING_PRIVATE_KEY environment variable is missing. " +
          "In non-test environments, a valid hex-encoded Ed25519 PKCS#8 private key is strictly required to sign evidence chains.",
      );
    }
  } else {
    if (!validateEd25519PrivateKey(signingPrivateKeyHex)) {
      throw new Error(
        "FATAL: SIGNING_PRIVATE_KEY is malformed. " +
          "Must be a valid hex-encoded DER PKCS#8 Ed25519 private key.",
      );
    }
    if (!signingPublicKeyHex) {
      try {
        signingPublicKeyHex = getPublicKeyFromPrivate(signingPrivateKeyHex);
      } catch (err) {
        throw new Error(
          `FATAL: Failed to derive public key from SIGNING_PRIVATE_KEY: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const stateMachine = new PurchaseStateMachineService(store);
  const evidenceService =
    options.evidenceService ||
    new EvidenceService(store, signingPrivateKeyHex, signingPublicKeyHex);

  const llm =
    options.llm ||
    (process.env.LLM_PROVIDER === "google" && process.env.LLM_API_KEY
      ? new GeminiLLMAdapter(process.env.LLM_API_KEY, process.env.LLM_MODEL)
      : new MockLLMAdapter());

  const tribunalRunner =
    options.tribunalRunner ||
    new TribunalRunner({
      store,
      stateMachine,
      evidenceService,
      paypalClient,
      llm,
      signingPrivateKeyHex,
    });

  const publicBaseUrl =
    options.publicBaseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:4000";
  const dashboardUrl = options.dashboardUrl || process.env.DASHBOARD_URL || "http://localhost:3000";
  const demoMode = options.demoMode ?? process.env.DEMO_MODE === "true";

  // Register API routes
  app.register(
    async (api) => {
      // Health check
      api.get("/health", async () => {
        return {
          status: "ok",
          service: "netrabox-api",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
          uptimeSeconds: process.uptime(),
        };
      });

      // Purchase lifecycle routes
      api.register(purchaseRoutes, {
        paypalClient,
        stateMachine,
        store,
        signingPrivateKeyHex,
        publicBaseUrl,
        dashboardUrl,
      });

      // Evidence routes
      api.register(evidenceRoutes, {
        evidenceService,
        demoMode,
      });

      // Dispute & Tribunal routes
      api.register(disputeRoutes, {
        tribunalRunner,
        stateMachine,
        signingPrivateKeyHex,
      });

      // Webhooks
      api.register(webhookRoutes, {
        paypalClient,
        stateMachine,
        signingPrivateKeyHex,
      });

      // DisputeBench routes
      api.register(benchRoutes);
    },
    { prefix: "/api/v1" },
  );

  // Root /bench compatibility
  app.register(benchRoutes);

  // Root /health compatibility
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "netrabox-api",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const server = buildServer();
  const port = Number(process.env.PORT) || 4000;
  const host = "0.0.0.0";

  server.listen({ port, host }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    console.log(`🚀 NetraBox API listening on ${address}`);
  });
}
