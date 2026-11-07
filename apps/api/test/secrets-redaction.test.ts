import { describe, it, expect } from "vitest";
import { buildServer, PINO_REDACT_PATHS } from "../src/server.js";
import { generateEd25519Keypair } from "@netrabox/core";

describe("Secret Handling & Redaction", () => {
  describe("Server Startup Key Resolution (Fail-Fast)", () => {
    it("fails fast in non-test mode if SIGNING_PRIVATE_KEY is missing", () => {
      const origEnv = process.env.SIGNING_PRIVATE_KEY;
      delete process.env.SIGNING_PRIVATE_KEY;

      try {
        expect(() => {
          buildServer({ isTest: false });
        }).toThrow(/FATAL: SIGNING_PRIVATE_KEY environment variable is missing/);
      } finally {
        if (origEnv) process.env.SIGNING_PRIVATE_KEY = origEnv;
      }
    });

    it("fails fast in non-test mode if SIGNING_PRIVATE_KEY is malformed", () => {
      expect(() => {
        buildServer({
          isTest: false,
          signingPrivateKeyHex: "invalid_malformed_key_hex_1234",
        });
      }).toThrow(/FATAL: SIGNING_PRIVATE_KEY is malformed/);
    });

    it("generates dynamic ephemeral keypairs in test mode without fixed literals", () => {
      const app1 = buildServer({ isTest: true });
      const app2 = buildServer({ isTest: true });

      expect(app1).toBeDefined();
      expect(app2).toBeDefined();
    });

    it("derives public key automatically from valid private key when public key is omitted", () => {
      const { privateKeyHex } = generateEd25519Keypair();
      const app = buildServer({
        isTest: false,
        signingPrivateKeyHex: privateKeyHex,
      });
      expect(app).toBeDefined();
    });
  });

  describe("Pino Redaction Configuration", () => {
    it("includes required redaction paths for authorization, cookies, secrets, and PayPal tokens", () => {
      expect(PINO_REDACT_PATHS).toContain("req.headers.authorization");
      expect(PINO_REDACT_PATHS).toContain("req.headers.cookie");
      expect(PINO_REDACT_PATHS).toContain("req.headers['set-cookie']");
      expect(PINO_REDACT_PATHS).toContain("*.password");
      expect(PINO_REDACT_PATHS).toContain("*.secret");
      expect(PINO_REDACT_PATHS).toContain("*.token");
      expect(PINO_REDACT_PATHS).toContain("*.client_secret");
      expect(PINO_REDACT_PATHS).toContain("*.clientSecret");
      expect(PINO_REDACT_PATHS).toContain("*.access_token");
      expect(PINO_REDACT_PATHS).toContain("*.accessToken");
      expect(PINO_REDACT_PATHS).toContain("*.PAYPAL_CLIENT_SECRET");
      expect(PINO_REDACT_PATHS).toContain("*.SIGNING_PRIVATE_KEY");
      expect(PINO_REDACT_PATHS).toContain("body.password");
      expect(PINO_REDACT_PATHS).toContain("body.secret");
      expect(PINO_REDACT_PATHS).toContain("body.token");
      expect(PINO_REDACT_PATHS).toContain("body.clientSecret");
    });
  });
});
