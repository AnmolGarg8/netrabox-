#!/usr/bin/env node
import { DisputeBenchRunner, formatMarkdownResults } from "./runner.js";

async function main() {
  console.log("==================================================================");
  console.log("            RUNNING DISPUTEBENCH EVALUATION SUITE                 ");
  console.log("==================================================================");
  console.log("Evaluating held-out test cases (reporting HELD-OUT TEST SET only)...");

  const runner = new DisputeBenchRunner();
  const summary = await runner.runBenchmark({ split: "test" });

  console.log("\n" + formatMarkdownResults(summary));
  console.log("\n✅ Evaluation complete. Saved to results.json and results.md");
}

main().catch((err) => {
  console.error("DisputeBench run failed:", err);
  process.exit(1);
});
