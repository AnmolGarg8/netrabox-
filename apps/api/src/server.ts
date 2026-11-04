import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";

export function buildServer() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  app.register(cors, {
    origin: true,
  });

  app.register(sensible);

  // Health check endpoint
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "netrabox-api",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
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
