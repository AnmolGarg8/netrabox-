import { sign, verify, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

export function generateEd25519Keypair(): { privateKeyHex: string; publicKeyHex: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { privateKeyHex, publicKeyHex };
}

export function validateEd25519PrivateKey(privateKeyHex: string): boolean {
  try {
    if (!privateKeyHex || typeof privateKeyHex !== "string") return false;
    if (privateKeyHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(privateKeyHex)) return false;
    const privateKeyDer = Buffer.from(privateKeyHex, "hex");
    if (privateKeyDer.length === 0) return false;
    const key = createPrivateKey({
      key: privateKeyDer,
      format: "der",
      type: "pkcs8",
    });
    return key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

export function getPublicKeyFromPrivate(privateKeyHex: string): string {
  const privateKeyDer = Buffer.from(privateKeyHex, "hex");
  const key = createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  const pub = createPublicKey(key);
  return pub.export({ type: "spki", format: "der" }).toString("hex");
}

export function signHash(hashHex: string, privateKeyHex: string): string {
  const privateKeyDer = Buffer.from(privateKeyHex, "hex");
  const key = createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  const data = Buffer.from(hashHex, "utf8");
  const signature = sign(undefined, data, key);
  return signature.toString("hex");
}

/**
 * Verifies an Ed25519 signature over a hash string.
 * Fails gracefully (returns false) without throwing unhandled errors for:
 * - Malformed signature strings (odd length, non-hex, empty)
 * - Malformed public key strings (odd length, non-hex, wrong DER encoding)
 * - Mismatched public keys / invalid signatures
 */
export function verifyHashSignature(
  hashHex: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    if (
      !signatureHex ||
      typeof signatureHex !== "string" ||
      signatureHex.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(signatureHex)
    ) {
      return false;
    }
    if (
      !publicKeyHex ||
      typeof publicKeyHex !== "string" ||
      publicKeyHex.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(publicKeyHex)
    ) {
      return false;
    }
    if (!hashHex || typeof hashHex !== "string") {
      return false;
    }

    const publicKeyDer = Buffer.from(publicKeyHex, "hex");
    const key = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });
    const data = Buffer.from(hashHex, "utf8");
    const signature = Buffer.from(signatureHex, "hex");
    return verify(undefined, data, key, signature);
  } catch {
    return false;
  }
}
