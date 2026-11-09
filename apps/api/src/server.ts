import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { PayPalClient } from "./services/paypal/client.js";
import { PurchaseStateMachineService, type IStateStore } from "./services/state-machine/machine.js";
import { DrizzleStateStore } from "./services/state-machine/drizzle-store.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { purchaseRoutes } from "./routes/purchases.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { disputeRoutes } from "./routes/disputes.js";
import { benchRoutes } from "./routes/bench.js";
import { EvidenceService } from "./services/evidence/service.js";
import { TribunalRunner } from "./services/tribunal/runner.js";
import { AuthExpiryMonitorJob } from "./services/jobs/auth-expiry.js";
import {
  MockLLMAdapter,
  GeminiLLMAdapter,
  type LLMAdapter,
  type DbType,
  generateEd25519Keypair,
  validateEd25519PrivateKey,
  getPublicKeyFromPrivate,
} from "@netrabox/core";
import { PolicyEngine } from "@netrabox/core";
import { SettlementService } from "./services/settlement/service.js";

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
  settlementService?: SettlementService;
  authExpiryJob?: AuthExpiryMonitorJob;
  authExpiryIntervalMs?: number;
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

  // Initialize backing state store (Default: DrizzleStateStore powered by Postgres)
  const store = options.store || new DrizzleStateStore();

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

  const policyEngine = new PolicyEngine();
  const settlementService =
    options.settlementService ||
    new SettlementService(store, paypalClient, policyEngine, signingPrivateKeyHex);

  const geminiApiKey = process.env.LLM_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const llm =
    options.llm ||
    (process.env.LLM_PROVIDER === "google" && geminiApiKey
      ? new GeminiLLMAdapter(geminiApiKey, process.env.LLM_MODEL)
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
      settlementService,
      db: store.getDb?.() as DbType | undefined,
    });

  const authExpiryJob =
    options.authExpiryJob ||
    new AuthExpiryMonitorJob(settlementService, {
      signingPrivateKeyHex,
      autoVoidCloseToExpiry: true,
    });

  const publicBaseUrl =
    options.publicBaseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:4000";
  const dashboardUrl = options.dashboardUrl || process.env.DASHBOARD_URL || "http://localhost:3000";
  const demoMode = options.demoMode ?? (process.env.DEMO_MODE === "true" || isTest);

  // Wire AuthExpiryMonitorJob into server background tick on configurable interval
  const authExpiryIntervalMs =
    options.authExpiryIntervalMs ??
    (process.env.AUTH_EXPIRY_INTERVAL_MS
      ? Number(process.env.AUTH_EXPIRY_INTERVAL_MS)
      : isTest
        ? 0
        : 60000);

  if (authExpiryIntervalMs > 0) {
    const timer = setInterval(async () => {
      try {
        await authExpiryJob.runScan(store);
      } catch (err) {
        app.log.error(err, "Error in AuthExpiryMonitorJob background tick");
      }
    }, authExpiryIntervalMs);
    timer.unref?.();

    app.addHook("onClose", async () => {
      clearInterval(timer);
    });
  }

  const handleAuthExpiryEndpoint = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!demoMode && !isTest) {
      return reply.status(403).send({ error: "Endpoint only available in demo mode" });
    }
    const scanResult = await authExpiryJob.runScan(store);
    return reply.send(scanResult);
  };

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

      // Jobs reconciliation endpoint
      api.post("/jobs/reconcile", async (request, reply) => {
        const body = (request.body as { olderThanMs?: number }) || {};
        const result = await settlementService.reconcile(body.olderThanMs ?? 30000);
        return reply.send({ status: "ok", ...result });
      });

      // Jobs auth-expiry endpoint (demo only)
      api.post("/jobs/auth-expiry", handleAuthExpiryEndpoint);

      // Purchase lifecycle routes
      api.register(purchaseRoutes, {
        paypalClient,
        stateMachine,
        store,
        signingPrivateKeyHex,
        publicBaseUrl,
        dashboardUrl,
        settlementService,
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
        store,
        settlementService,
        db: store.getDb?.() as DbType | undefined,
      });

      // Webhooks
      api.register(webhookRoutes, {
        paypalClient,
        stateMachine,
        signingPrivateKeyHex,
        db: store.getDb?.() as DbType | undefined,
      });

      // DisputeBench routes
      api.register(benchRoutes);
    },
    { prefix: "/api/v1" },
  );

  // Root /bench compatibility
  app.register(benchRoutes);

  // Root /jobs/reconcile compatibility
  app.post("/jobs/reconcile", async (request, reply) => {
    const body = (request.body as { olderThanMs?: number }) || {};
    const result = await settlementService.reconcile(body.olderThanMs ?? 30000);
    return reply.send({ status: "ok", ...result });
  });

  // Root /jobs/auth-expiry compatibility (demo only)
  app.post("/jobs/auth-expiry", handleAuthExpiryEndpoint);

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
