import { createHash } from "node:crypto";

export interface MerkleProofStep {
  position: "left" | "right";
  hash: string;
}

export interface MerkleProof {
  leafHash: string;
  leafIndex: number;
  root: string;
  proof: MerkleProofStep[];
}

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

/**
 * Generates an audit inclusion proof for a leaf in a Merkle tree.
 */
export function generateMerkleProof(hashes: string[], leafIndex: number): MerkleProof {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    throw new Error("Cannot generate Merkle proof for empty leaves");
  }

  if (
    typeof leafIndex !== "number" ||
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= hashes.length
  ) {
    throw new Error(
      `Invalid leafIndex: ${leafIndex}. Must be an integer between 0 and ${hashes.length - 1}`,
    );
  }

  if (hashes.length === 1) {
    return {
      leafHash: hashes[0],
      leafIndex: 0,
      root: hashes[0],
      proof: [],
    };
  }

  const proof: MerkleProofStep[] = [];
  let currentIdx = leafIndex;
  let currentLevel = [...hashes];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    const isEven = currentIdx % 2 === 0;

    if (isEven) {
      const siblingIdx = currentIdx + 1;
      const siblingHash =
        siblingIdx < currentLevel.length ? currentLevel[siblingIdx] : currentLevel[currentIdx];
      proof.push({ position: "right", hash: siblingHash });
    } else {
      const siblingIdx = currentIdx - 1;
      const siblingHash = currentLevel[siblingIdx];
      proof.push({ position: "left", hash: siblingHash });
    }

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;

      const combined = left + right;
      const parentHash = createHash("sha256").update(combined, "utf8").digest("hex");
      nextLevel.push(parentHash);
    }

    currentIdx = Math.floor(currentIdx / 2);
    currentLevel = nextLevel;
  }

  return {
    leafHash: hashes[leafIndex],
    leafIndex,
    root: currentLevel[0],
    proof,
  };
}

/**
 * Verifies that a leafHash is included in a Merkle tree with the given root and proof.
 */
export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  root: string,
): boolean {
  if (typeof leafHash !== "string" || typeof root !== "string" || !Array.isArray(proof)) {
    return false;
  }

  if (proof.length === 0) {
    return leafHash === root;
  }

  let currentHash = leafHash;

  for (const step of proof) {
    if (!step || typeof step.hash !== "string") {
      return false;
    }

    let combined: string;
    if (step.position === "right") {
      combined = currentHash + step.hash;
    } else if (step.position === "left") {
      combined = step.hash + currentHash;
    } else {
      return false;
    }

    currentHash = createHash("sha256").update(combined, "utf8").digest("hex");
  }

  return currentHash === root;
}

// Aliases as requested in specification
export const generateProof = generateMerkleProof;
export const verifyProof = verifyMerkleProof;
