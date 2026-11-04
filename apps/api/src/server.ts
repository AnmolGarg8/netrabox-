import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { PayPalClient } from "./services/paypal/client.js";
import { PurchaseStateMachineService, type IStateStore } from "./services/state-machine/machine.js";
import { InMemoryStateStore } from "./services/state-machine/in-memory-store.js";
import { DrizzleStateStore } from "./services/state-machine/drizzle-store.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { purchaseRoutes } from "./routes/purchases.js";

export interface ServerOptions {
  store?: IStateStore;
  paypalClient?: PayPalClient;
  signingPrivateKeyHex?: string;
  publicBaseUrl?: string;
  dashboardUrl?: string;
  isTest?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const isTest = options.isTest ?? process.env.NODE_ENV === "test";

  const app = Fastify({
    logger: !isTest,
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

  // Default fallback signing private key (valid Ed25519 pkcs8 hex)
  const signingPrivateKeyHex =
    options.signingPrivateKeyHex ||
    process.env.SIGNING_PRIVATE_KEY ||
    "";

  const stateMachine = new PurchaseStateMachineService(store);
  const publicBaseUrl =
    options.publicBaseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:4000";
  const dashboardUrl = options.dashboardUrl || process.env.DASHBOARD_URL || "http://localhost:3000";

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

      // Webhooks
      api.register(webhookRoutes, {
        paypalClient,
        stateMachine,
        signingPrivateKeyHex,
      });
    },
    { prefix: "/api/v1" },
  );

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

const server = buildServer();
const port = Number(process.env.PORT) || 4000;
const host = "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  server.listen({ port, host }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    console.log(`🚀 NetraBox API listening on ${address}`);
  });
}
