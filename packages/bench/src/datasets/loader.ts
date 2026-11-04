import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchTestCase } from "../types.js";
import { writeCasesJsonl } from "./generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES_JSONL_PATH = resolve(__dirname, "cases.jsonl");

export function loadBenchmarkCases(splitFilter?: "dev" | "test"): BenchTestCase[] {
  let cases: BenchTestCase[];

  if (existsSync(CASES_JSONL_PATH)) {
    try {
      const content = readFileSync(CASES_JSONL_PATH, "utf8");
      cases = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as BenchTestCase);
    } catch {
      cases = writeCasesJsonl(CASES_JSONL_PATH);
    }
  } else {
    cases = writeCasesJsonl(CASES_JSONL_PATH);
  }

  if (splitFilter) {
    return cases.filter((c) => c.split === splitFilter);
  }
  return cases;
}

export function getCasesFilePath(): string {
  if (!existsSync(CASES_JSONL_PATH)) {
    writeCasesJsonl(CASES_JSONL_PATH);
  }
  return CASES_JSONL_PATH;
}
