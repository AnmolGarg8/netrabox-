import { createHash } from "node:crypto";

/**
 * Computes a SHA-256 Merkle root from a list of leaf hashes.
 * If empty, returns 64 zeroes.
 * If odd number of leaves at any level, duplicates the last leaf.
 */
export function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return "0000000000000000000000000000000000000000000000000000000000000000";
  }

  let currentLevel = [...hashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;

      const combined = left + right;
      const parentHash = createHash("sha256").update(combined, "utf8").digest("hex");
      nextLevel.push(parentHash);
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
}
