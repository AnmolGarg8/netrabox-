import { generateKeyPairSync } from "node:crypto";

function generateEd25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Export raw PKCS#8 and SPKI key material as hex
  const privHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  console.log("==================================================================");
  console.log("  NetraBox Ed25519 Keypair Generated Successfully");
  console.log("==================================================================");
  console.log("");
  console.log("# Copy the following lines into your .env file:");
  console.log(`SIGNING_PRIVATE_KEY=${privHex}`);
  console.log(`SIGNING_PUBLIC_KEY=${pubHex}`);
  console.log("");
  console.log("⚠️  NEVER commit these keys or store them in source control.");
  console.log("==================================================================");
}

generateEd25519Keypair();
