import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";

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

export function verifyHashSignature(
  hashHex: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
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
