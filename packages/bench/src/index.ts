import type { TribunalClassification } from "@netrabox/core";

export interface DisputeTestCase {
  id: string;
  category: TribunalClassification | "TAMPERED_CHAIN";
  title: string;
  description: string;
  groundTruth: {
    classification: TribunalClassification | "TAMPERED_CHAIN";
    expectedLiabilitySplit: { buyer: number; agentProvider: number; merchant: number };
    shouldBlockDueToTamper?: boolean;
  };
}

export const BENCHMARK_METADATA = {
  suiteName: "DisputeBench",
  version: "1.0.0",
  targetCases: 50,
};
