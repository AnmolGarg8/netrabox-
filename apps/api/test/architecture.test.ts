import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Architecture Invariant: Single Money-Movement Path (SettlementService)", () => {
  const MUTATING_METHODS = ["captureAuthorization", "voidAuthorization", "refundCapture"];

  // Allowed files:
  // 1. PayPalClient itself where the methods are implemented
  // 2. SettlementService, the ONLY authorized caller
  // 3. Test files that mock or test these methods
  const ALLOWED_FILES = [
    "apps/api/src/services/paypal/client.ts",
    "apps/api/src/services/settlement/service.ts",
  ];

  function checkDir(
    dir: string,
    violations: Array<{ file: string; line: number; method: string; code: string }>,
  ) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const normalized = fullPath.replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".next" ||
          entry.name === ".git" ||
          entry.name === "test" || // test directory is exempted from production architecture scan
          normalized.includes("/test/")
        ) {
          continue;
        }
        checkDir(fullPath, violations);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        const isAllowed = ALLOWED_FILES.some((allowed) => normalized.endsWith(allowed));
        if (isAllowed) continue;

        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          // Skip comments
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

          for (const method of MUTATING_METHODS) {
            const regex = new RegExp(`\\.${method}\\s*\\(`, "g");
            if (regex.test(line)) {
              violations.push({
                file: normalized,
                line: idx + 1,
                method,
                code: trimmed,
              });
            }
          }
        }
      }
    }
  }

  it("strictly enforces that ONLY SettlementService calls mutating PayPal methods", () => {
    const rootDir = path.resolve(__dirname, "../../..");
    const violations: Array<{ file: string; line: number; method: string; code: string }> = [];

    // Scan apps and packages
    checkDir(path.join(rootDir, "apps"), violations);
    checkDir(path.join(rootDir, "packages"), violations);

    expect(
      violations,
      `Detected unauthorized direct calls to mutating PayPal methods outside SettlementService: \n${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });
});
